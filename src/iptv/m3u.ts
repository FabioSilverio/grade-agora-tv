import type { Channel, StreamHeaders, VodItem } from './types'

export type ParsedM3u = {
  channels: Channel[]
  movies: VodItem[]
  epgUrls: string[]
}

type Entry = {
  name: string
  attrs: Record<string, string>
  group?: string
  headers: StreamHeaders
}

const ATTR_RE = /([\w-]+)=("([^"]*)"|'([^']*)'|[^\s,]+)/g

/** Parser de listas M3U/M3U8 estendidas (#EXTINF com tvg-id, tvg-logo, group-title...). */
export function parseM3u(text: string): ParsedM3u {
  const channels: Channel[] = []
  const movies: VodItem[] = []
  const epgUrls: string[] = []
  const usedIds = new Map<string, number>()

  let current: Entry | null = null
  let pendingGroup: string | undefined
  let pendingHeaders: StreamHeaders = {}

  const lines = text.split(/\r?\n/)
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    if (line.startsWith('#EXTM3U')) {
      const attrs = parseAttrs(line)
      for (const key of ['url-tvg', 'x-tvg-url', 'tvg-url']) {
        if (attrs[key]) epgUrls.push(...attrs[key].split(',').map((url) => url.trim()).filter(Boolean))
      }
      continue
    }

    if (line.startsWith('#EXTINF')) {
      const { attrs, name } = parseExtinf(line)
      current = { name, attrs, headers: { ...pendingHeaders } }
      if (pendingGroup) current.group = pendingGroup
      continue
    }

    if (line.startsWith('#EXTGRP:')) {
      pendingGroup = line.slice(8).trim()
      if (current) current.group = pendingGroup
      continue
    }

    if (line.startsWith('#EXTVLCOPT:')) {
      const [key, ...rest] = line.slice(11).split('=')
      const value = rest.join('=').trim()
      const target = current ? current.headers : pendingHeaders
      if (/http-user-agent/i.test(key)) target.userAgent = value
      if (/http-referr?er/i.test(key)) target.referer = value
      continue
    }

    if (line.startsWith('#')) continue

    // Linha de URL
    const entry: Entry = current ?? { name: line, attrs: {}, headers: {} }
    const url = line
    const attrs = entry.attrs
    const group = attrs['group-title'] || entry.group || 'Sem grupo'
    const name = entry.name || attrs['tvg-name'] || url
    const logo = attrs['tvg-logo'] || attrs.logo || undefined
    const headers = cleanHeaders({
      userAgent: entry.headers.userAgent || attrs['user-agent'] || attrs['http-user-agent'],
      referer: entry.headers.referer || attrs.referer || attrs['http-referrer'],
    })

    const baseId = attrs['tvg-id'] && attrs['tvg-id'] !== '' ? `${attrs['tvg-id']}|${name}` : `${name}|${group}`
    const count = usedIds.get(baseId) ?? 0
    usedIds.set(baseId, count + 1)
    const id = hash(count ? `${baseId}#${count}` : baseId)

    if (isVodUrl(url)) {
      movies.push({ id, name, logo, group, url, headers, ext: extensionOf(url) })
    } else {
      channels.push({
        id,
        name,
        logo,
        group,
        url,
        altUrls: xtreamHlsAlternative(url),
        epgId: attrs['tvg-id'] || undefined,
        num: attrs['tvg-chno'] ? Number(attrs['tvg-chno']) || undefined : undefined,
        headers,
      })
    }

    current = null
    pendingHeaders = {}
  }

  return { channels, movies, epgUrls: [...new Set(epgUrls)] }
}

function parseAttrs(text: string) {
  const attrs: Record<string, string> = {}
  for (const match of text.matchAll(ATTR_RE)) {
    attrs[match[1].toLowerCase()] = match[3] ?? match[4] ?? match[2]
  }
  return attrs
}

/** #EXTINF:-1 tvg-id="x" group-title="y, z",Nome do canal */
function parseExtinf(line: string) {
  let inQuote: string | null = null
  let commaAt = -1
  for (let index = 8; index < line.length; index += 1) {
    const char = line[index]
    if (inQuote) {
      if (char === inQuote) inQuote = null
    } else if (char === '"' || char === "'") {
      inQuote = char
    } else if (char === ',') {
      commaAt = index
      break
    }
  }
  const head = commaAt >= 0 ? line.slice(0, commaAt) : line
  const name = commaAt >= 0 ? line.slice(commaAt + 1).trim() : ''
  return { attrs: parseAttrs(head), name }
}

function cleanHeaders(headers: StreamHeaders): StreamHeaders | undefined {
  if (!headers.userAgent && !headers.referer) return undefined
  return headers
}

function isVodUrl(url: string) {
  if (/\/(movie|series)\//i.test(url)) return true
  return /\.(mp4|mkv|avi|mov|wmv|m4v|webm)(\?|$)/i.test(url)
}

function extensionOf(url: string) {
  return url.match(/\.(\w{2,4})(\?|$)/)?.[1]?.toLowerCase()
}

/**
 * Listas no padrao Xtream (http://host/user/pass/123 ou /live/user/pass/123.ts)
 * quase sempre tambem servem HLS em /live/user/pass/123.m3u8, que toca melhor no
 * navegador e passa pelo proxy em pedacos curtos.
 */
export function xtreamHlsAlternative(url: string): string[] | undefined {
  const match = url.match(/^(https?:\/\/[^/]+)\/(?:live\/)?([^/]+)\/([^/]+)\/(\d+)(?:\.ts)?$/i)
  if (!match) return undefined
  const [, origin, user, pass, id] = match
  return [`${origin}/live/${user}/${pass}/${id}.m3u8`]
}

export function hash(value: string) {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    h1 = Math.imul(h1 ^ code, 2654435761)
    h2 = Math.imul(h2 ^ code, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}
