// Descobre por que um canal nao toca: baixa o comeco do stream e identifica os
// codecs (tabela PMT do MPEG-TS, atributo CODECS do HLS ou caixas do fMP4) ou
// a pagina de erro que o servidor mandou no lugar do video.

import { parseHls } from './hls'
import { smartFetch, type NetConfig } from './net'
import type { StreamHeaders } from './types'

type Codec = { kind: 'video' | 'audio'; id: string; label: string }

const SAMPLE_BYTES = 192 * 1024

const CODEC_TESTS: Record<string, string> = {
  h264: 'video/mp4; codecs="avc1.640028"',
  hevc: 'video/mp4; codecs="hvc1.1.6.L120.90"',
  aac: 'audio/mp4; codecs="mp4a.40.2"',
  mp3: 'audio/mpeg',
  ac3: 'audio/mp4; codecs="ac-3"',
  eac3: 'audio/mp4; codecs="ec-3"',
  vp9: 'video/mp4; codecs="vp09.00.10.08"',
  opus: 'audio/mp4; codecs="opus"',
}

function supported(id: string) {
  const type = CODEC_TESTS[id]
  if (!type || typeof MediaSource === 'undefined') return false
  try {
    return MediaSource.isTypeSupported(type)
  } catch {
    return false
  }
}

async function readSample(url: string, net: NetConfig, headers?: StreamHeaders) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15_000)
  try {
    const { response, finalUrl } = await smartFetch(url, net, { signal: controller.signal }, headers)
    const contentType = response.headers.get('content-type') ?? ''
    const chunks: Uint8Array[] = []
    let size = 0
    if (response.body) {
      const reader = response.body.getReader()
      while (size < SAMPLE_BYTES) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        size += value.byteLength
      }
      void reader.cancel().catch(() => undefined)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return { status: response.status, ok: response.ok, contentType, finalUrl, bytes }
  } finally {
    clearTimeout(timer)
    controller.abort()
  }
}

// ---------- MPEG-TS: PAT -> PMT -> tipos de stream ----------

export function tsCodecs(bytes: Uint8Array): Codec[] | null {
  let start = -1
  for (let index = 0; index < Math.min(bytes.length - 376, 4096); index += 1) {
    if (bytes[index] === 0x47 && bytes[index + 188] === 0x47 && bytes[index + 376] === 0x47) {
      start = index
      break
    }
  }
  if (start < 0) return null

  const pmtPids = new Set<number>()
  for (let pass = 0; pass < 2; pass += 1) {
    for (let p = start; p + 188 <= bytes.length; p += 188) {
      if (bytes[p] !== 0x47) continue
      const pid = ((bytes[p + 1] & 0x1f) << 8) | bytes[p + 2]
      const unitStart = bytes[p + 1] & 0x40
      const adaptation = (bytes[p + 3] >> 4) & 3
      if (!unitStart || !(adaptation & 1)) continue
      let payload = p + 4 + (adaptation & 2 ? 1 + bytes[p + 4] : 0)
      if (payload >= p + 188) continue
      payload += 1 + bytes[payload] // pointer field
      const sectionLength = ((bytes[payload + 1] & 0x0f) << 8) | bytes[payload + 2]
      const end = Math.min(payload + 3 + sectionLength - 4, p + 188)

      if (pass === 0 && pid === 0 && bytes[payload] === 0x00) {
        for (let index = payload + 8; index + 4 <= end; index += 4) {
          const program = (bytes[index] << 8) | bytes[index + 1]
          if (program !== 0) pmtPids.add(((bytes[index + 2] & 0x1f) << 8) | bytes[index + 3])
        }
      }

      if (pass === 1 && pmtPids.has(pid) && bytes[payload] === 0x02) {
        const programInfo = ((bytes[payload + 10] & 0x0f) << 8) | bytes[payload + 11]
        const codecs: Codec[] = []
        for (let index = payload + 12 + programInfo; index + 5 <= end; ) {
          const type = bytes[index]
          const esInfo = ((bytes[index + 3] & 0x0f) << 8) | bytes[index + 4]
          const descriptors = bytes.subarray(index + 5, index + 5 + esInfo)
          const codec = streamTypeCodec(type, descriptors)
          if (codec) codecs.push(codec)
          index += 5 + esInfo
        }
        return codecs
      }
    }
    if (pass === 0 && !pmtPids.size) return []
  }
  return []
}

function streamTypeCodec(type: number, descriptors: Uint8Array): Codec | null {
  switch (type) {
    case 0x1b:
      return { kind: 'video', id: 'h264', label: 'H.264' }
    case 0x24:
      return { kind: 'video', id: 'hevc', label: 'H.265 (HEVC)' }
    case 0x01:
    case 0x02:
      return { kind: 'video', id: 'mpeg2', label: 'MPEG-2' }
    case 0x0f:
    case 0x11:
      return { kind: 'audio', id: 'aac', label: 'AAC' }
    case 0x03:
    case 0x04:
      return { kind: 'audio', id: 'mp3', label: 'MP2/MP3' }
    case 0x81:
      return { kind: 'audio', id: 'ac3', label: 'Dolby AC-3' }
    case 0x87:
      return { kind: 'audio', id: 'eac3', label: 'Dolby E-AC-3' }
    case 0x06:
      for (let index = 0; index + 2 <= descriptors.length; index += 2 + descriptors[index + 1]) {
        const tag = descriptors[index]
        if (tag === 0x6a) return { kind: 'audio', id: 'ac3', label: 'Dolby AC-3' }
        if (tag === 0x7a) return { kind: 'audio', id: 'eac3', label: 'Dolby E-AC-3' }
        if (tag === 0x7b) return { kind: 'audio', id: 'dts', label: 'DTS' }
      }
      return null
    default:
      return null
  }
}

// ---------- HLS / fMP4 ----------

function codecsFromString(value: string): Codec[] {
  const codecs: Codec[] = []
  const add = (codec: Codec) => !codecs.some((item) => item.id === codec.id) && codecs.push(codec)
  for (const raw of value.split(/[,\s]+/)) {
    const item = raw.toLowerCase()
    if (item.startsWith('avc')) add({ kind: 'video', id: 'h264', label: 'H.264' })
    else if (item.startsWith('hvc') || item.startsWith('hev')) add({ kind: 'video', id: 'hevc', label: 'H.265 (HEVC)' })
    else if (item.startsWith('vp09') || item === 'vp9') add({ kind: 'video', id: 'vp9', label: 'VP9' })
    else if (item.startsWith('mp4a.40.34') || item === 'mp3') add({ kind: 'audio', id: 'mp3', label: 'MP3' })
    else if (item.startsWith('mp4a')) add({ kind: 'audio', id: 'aac', label: 'AAC' })
    else if (item === 'ac-3') add({ kind: 'audio', id: 'ac3', label: 'Dolby AC-3' })
    else if (item === 'ec-3') add({ kind: 'audio', id: 'eac3', label: 'Dolby E-AC-3' })
    else if (item === 'opus') add({ kind: 'audio', id: 'opus', label: 'Opus' })
  }
  return codecs
}

/** Procura os nomes das caixas de codec dentro do init segment do fMP4. */
function mp4Codecs(bytes: Uint8Array): Codec[] {
  const text = String.fromCharCode(...bytes.subarray(0, Math.min(bytes.length, 64 * 1024)))
  const found = ['avc1', 'avc3', 'hvc1', 'hev1', 'vp09', 'mp4a', 'ac-3', 'ec-3', 'Opus'].filter((box) => text.includes(box))
  return codecsFromString(found.join(',').replace('Opus', 'opus'))
}

function looksLikeText(bytes: Uint8Array) {
  const head = new TextDecoder().decode(bytes.subarray(0, 512)).trim()
  return /^(<!doctype|<html|<\?xml|\{|\[|<)/i.test(head) ? head : null
}

// ---------- diagnostico ----------

export type Diagnosis = { message: string; codecs?: Codec[]; /** codec que o navegador nao toca: nao adianta tentar de novo */ blocked?: boolean }

function verdict(codecs: Codec[]): Diagnosis {
  const names = codecs.map((codec) => `${codec.kind === 'video' ? 'video' : 'audio'} ${codec.label}`).join(', ')
  const blockers = codecs.filter((codec) => !supported(codec.id))
  if (!codecs.length) return { message: 'O stream chega, mas nao consegui identificar os codecs.' }
  if (!blockers.length) {
    return {
      message: `Formato do canal: ${names} — compativel com este navegador. A falha deve ter sido do servidor (instabilidade ou limite de conexoes). Tente de novo em alguns segundos.`,
      codecs,
    }
  }
  const tips = blockers.map((codec) => {
    if (codec.id === 'hevc') return 'video H.265 (HEVC): este navegador nao decodifica. No Microsoft Edge com as "Extensoes de Video HEVC" da Microsoft Store costuma tocar'
    if (codec.id === 'ac3' || codec.id === 'eac3') return `audio ${codec.label}: o Chrome nao toca Dolby; o Microsoft Edge costuma tocar`
    if (codec.id === 'mpeg2') return 'video MPEG-2: nenhum navegador toca esse formato'
    if (codec.id === 'dts') return 'audio DTS: nenhum navegador toca esse formato'
    return `${codec.kind === 'video' ? 'video' : 'audio'} ${codec.label}: nao suportado neste navegador`
  })
  return {
    message: `Este canal usa ${tips.join('; ')}. A gravacao funciona normalmente e o arquivo abre no VLC.`,
    codecs,
    blocked: true,
  }
}

export async function diagnoseStream(url: string, net: NetConfig, headers?: StreamHeaders): Promise<Diagnosis> {
  const first = await readSample(url, net, headers)
  if (!first.ok) {
    const text = looksLikeText(first.bytes)
    return {
      message: `O servidor respondeu HTTP ${first.status}${text ? `: ${text.slice(0, 140)}` : ''}. Pode ser limite de conexoes da conta, conta vencida ou canal fora do ar.`,
    }
  }

  const head = new TextDecoder().decode(first.bytes.subarray(0, 64)).trimStart()
  if (head.startsWith('#EXTM3U')) {
    let playlist = parseHls(new TextDecoder().decode(first.bytes), first.finalUrl)
    if (playlist.kind === 'master') {
      const master = new TextDecoder().decode(first.bytes)
      const declared = [...master.matchAll(/CODECS="([^"]+)"/g)].map((match) => match[1]).join(',')
      if (declared) return verdict(codecsFromString(declared))
      const variant = playlist.variants[0]
      if (!variant) return { message: 'Playlist HLS sem variantes de video.' }
      const media = await readSample(variant.uri, net, headers)
      playlist = parseHls(new TextDecoder().decode(media.bytes), media.finalUrl)
    }
    if (playlist.kind !== 'media' || !playlist.segments.length) return { message: 'A playlist do canal veio vazia (canal fora do ar?).' }
    const segment = playlist.segments[playlist.segments.length - 1]
    const sample = await readSample(segment.map ?? segment.uri, net, headers)
    if (!sample.ok) return { message: `O segmento de video respondeu HTTP ${sample.status} (limite de conexoes ou canal fora do ar).` }
    const fromTs = tsCodecs(sample.bytes)
    if (fromTs) return verdict(fromTs)
    if (segment.key) return { message: 'Os segmentos sao criptografados; nao consegui inspecionar os codecs.' }
    return verdict(mp4Codecs(sample.bytes))
  }

  const fromTs = tsCodecs(first.bytes)
  if (fromTs) return verdict(fromTs)
  const text = looksLikeText(first.bytes)
  if (text) {
    return {
      message: `O servidor mandou uma pagina em vez de video (conta vencida, limite de conexoes ou bloqueio): ${text.replace(/\s+/g, ' ').slice(0, 160)}`,
    }
  }
  const mp4 = mp4Codecs(first.bytes)
  if (mp4.length) return verdict(mp4)
  return { message: `O servidor mandou um formato desconhecido (${first.contentType || 'sem tipo'}).` }
}

/** Diagnostica as URLs em ordem e fica com o resultado mais informativo (com codecs). */
export async function diagnoseUrls(urls: string[], net: NetConfig, headers?: StreamHeaders) {
  let best: Diagnosis | null = null
  for (const url of urls) {
    const result = await diagnoseStream(url, net, headers).catch(() => null)
    best ??= result
    if (result?.codecs) return result
  }
  return best
}
