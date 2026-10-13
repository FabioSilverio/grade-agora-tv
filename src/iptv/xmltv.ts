import type { Programme } from './types'

export type XmltvIndex = {
  /** id do canal na XMLTV (minusculo) -> programas ordenados. */
  programmes: Record<string, Programme[]>
  /** nome normalizado -> id do canal na XMLTV (minusculo). */
  names: Record<string, string>
}

type ParseOptions = {
  wantedIds: Set<string>
  wantedNames: Set<string>
  from: number
  to: number
  onProgress?: (programmes: number) => void
}

/**
 * Parser incremental de XMLTV: processa o arquivo em pedacos sem montar um DOM
 * (arquivos de EPG passam facil de 100 MB) e guarda so os canais da playlist.
 */
export async function parseXmltvStream(stream: ReadableStream<Uint8Array>, options: ParseOptions): Promise<XmltvIndex> {
  const index: XmltvIndex = { programmes: {}, names: {} }
  const keepIds = new Set<string>()
  const keepAll = options.wantedIds.size === 0 && options.wantedNames.size === 0
  let count = 0

  const reader = stream.pipeThrough(new TextDecoderStream() as unknown as ReadableWritablePair<string, Uint8Array>).getReader()
  let buffer = ''

  const handle = (tag: 'channel' | 'programme', element: string) => {
    if (tag === 'channel') {
      const id = (attr(element, 'id') ?? '').toLowerCase()
      if (!id) return
      let keep = keepAll || options.wantedIds.has(id)
      for (const match of element.matchAll(/<display-name[^>]*>([\s\S]*?)<\/display-name>/g)) {
        const name = normalizeName(decodeEntities(match[1]))
        if (!name) continue
        if (options.wantedNames.has(name)) {
          keep = true
          index.names[name] ??= id
        }
      }
      if (keep) keepIds.add(id)
      return
    }

    const channel = (attr(element, 'channel') ?? '').toLowerCase()
    if (!keepAll && !keepIds.has(channel) && !options.wantedIds.has(channel)) return
    const start = parseXmltvDate(attr(element, 'start'))
    const stop = parseXmltvDate(attr(element, 'stop'))
    if (!Number.isFinite(start) || !Number.isFinite(stop) || stop <= options.from || start >= options.to) return

    const programme: Programme = {
      start,
      stop,
      title: decodeEntities(innerText(element, 'title') ?? '') || 'Sem titulo',
    }
    const desc = innerText(element, 'desc')
    if (desc) programme.desc = decodeEntities(desc).slice(0, 400)
    const category = innerText(element, 'category')
    if (category) programme.category = decodeEntities(category)
    ;(index.programmes[channel] ??= []).push(programme)
    count += 1
    if (count % 5000 === 0) options.onProgress?.(count)
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (value) buffer += value
    let pos = 0
    for (;;) {
      const nextProgramme = buffer.indexOf('<programme', pos)
      const nextChannel = buffer.indexOf('<channel', pos)
      let start: number
      let tag: 'channel' | 'programme'
      if (nextProgramme < 0 && nextChannel < 0) {
        pos = Math.max(pos, buffer.length - 16)
        break
      }
      if (nextChannel >= 0 && (nextProgramme < 0 || nextChannel < nextProgramme)) {
        start = nextChannel
        tag = 'channel'
      } else {
        start = nextProgramme
        tag = 'programme'
      }

      const openEnd = buffer.indexOf('>', start)
      if (openEnd < 0) {
        pos = start
        break
      }
      if (buffer[openEnd - 1] === '/') {
        handle(tag, buffer.slice(start, openEnd + 1))
        pos = openEnd + 1
        continue
      }
      const close = `</${tag}>`
      const end = buffer.indexOf(close, openEnd)
      if (end < 0) {
        pos = start
        break
      }
      handle(tag, buffer.slice(start, end + close.length))
      pos = end + close.length
    }
    buffer = buffer.slice(pos)
    if (done) break
  }

  for (const list of Object.values(index.programmes)) list.sort((a, b) => a.start - b.start)
  options.onProgress?.(count)
  return index
}

function attr(element: string, name: string) {
  const match = element.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`))
  return match ? decodeEntities(match[2] ?? match[3] ?? '') : undefined
}

function innerText(element: string, tag: string) {
  const match = element.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`))
  if (!match) return undefined
  return match[1].replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1').trim()
}

export function parseXmltvDate(value: string | undefined) {
  if (!value) return Number.NaN
  const match = value.trim().match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{2}:?\d{2})?/)
  if (!match) return Number.NaN
  const [, year, month, day, hour, minute, second = '00', offset = '+0000'] = match
  const off = offset.replace(':', '')
  return Date.parse(`${year}-${month}-${day}T${hour}:${minute}:${second}${off.slice(0, 3)}:${off.slice(3)}`)
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

export function decodeEntities(value: string) {
  if (!value.includes('&')) return value.trim()
  return value
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, code: string) => {
      if (code[0] === '#') {
        const num = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
        return Number.isFinite(num) ? String.fromCodePoint(num) : whole
      }
      return ENTITIES[code.toLowerCase()] ?? whole
    })
    .trim()
}

/** Normaliza nomes de canal para cruzar playlist x EPG ("BR: Globo SP FHD" -> "globosp"). */
export function normalizeName(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/^\s*(\[[^\]]*\]|\([^)]*\)|[a-z]{2,3}\s*[:|])\s*/, '')
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/\b(fhd|uhd|hd|sd|4k|8k|h265|hevc|h264|60fps|50fps|hdr|alt|backup|vip)\b/g, ' ')
    .replace(/&/g, 'e')
    .replace(/[^a-z0-9+]/g, '')
}
