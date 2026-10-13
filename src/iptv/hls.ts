// Parser minimo de playlists HLS usado pelo gravador.

export type HlsKey = { method: string; uri?: string; iv?: string }

export type HlsSegment = {
  seq: number
  uri: string
  duration: number
  key?: HlsKey
  map?: string
}

export type MediaPlaylist = {
  kind: 'media'
  targetDuration: number
  mediaSequence: number
  segments: HlsSegment[]
  endList: boolean
}

export type MasterPlaylist = {
  kind: 'master'
  variants: Array<{ uri: string; bandwidth: number; resolution?: string }>
}

export function parseHls(text: string, baseUrl: string): MediaPlaylist | MasterPlaylist {
  const lines = text.split(/\r?\n/).map((line) => line.trim())
  const resolve = (uri: string) => new URL(uri, baseUrl).href

  if (lines.some((line) => line.startsWith('#EXT-X-STREAM-INF'))) {
    const variants: MasterPlaylist['variants'] = []
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]
      if (!line.startsWith('#EXT-X-STREAM-INF')) continue
      const attrs = parseAttrList(line)
      const uri = lines.slice(index + 1).find((next) => next && !next.startsWith('#'))
      if (uri) variants.push({ uri: resolve(uri), bandwidth: Number(attrs.BANDWIDTH) || 0, resolution: attrs.RESOLUTION })
    }
    return { kind: 'master', variants }
  }

  const playlist: MediaPlaylist = { kind: 'media', targetDuration: 6, mediaSequence: 0, segments: [], endList: false }
  let key: HlsKey | undefined
  let map: string | undefined
  let duration = 0
  let seq = 0
  let seqInitialized = false

  for (const line of lines) {
    if (!line) continue
    if (line.startsWith('#EXT-X-TARGETDURATION:')) playlist.targetDuration = Number(line.split(':')[1]) || 6
    else if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      playlist.mediaSequence = Number(line.split(':')[1]) || 0
      seq = playlist.mediaSequence
      seqInitialized = true
    } else if (line.startsWith('#EXT-X-KEY:')) {
      const attrs = parseAttrList(line)
      key = attrs.METHOD === 'NONE' ? undefined : { method: attrs.METHOD, uri: attrs.URI && resolve(attrs.URI), iv: attrs.IV }
    } else if (line.startsWith('#EXT-X-MAP:')) {
      const attrs = parseAttrList(line)
      map = attrs.URI ? resolve(attrs.URI) : undefined
    } else if (line.startsWith('#EXTINF:')) duration = parseFloat(line.slice(8)) || 0
    else if (line.startsWith('#EXT-X-ENDLIST')) playlist.endList = true
    else if (!line.startsWith('#')) {
      if (!seqInitialized) seqInitialized = true
      playlist.segments.push({ seq, uri: resolve(line), duration, key, map })
      seq += 1
      duration = 0
    }
  }
  return playlist
}

function parseAttrList(line: string) {
  const attrs: Record<string, string> = {}
  const body = line.slice(line.indexOf(':') + 1)
  for (const match of body.matchAll(/([A-Z0-9-]+)=("([^"]*)"|[^,]*)/g)) attrs[match[1]] = match[3] ?? match[2]
  return attrs
}

/** AES-128 (CBC) do HLS. IV padrao = numero de sequencia do segmento. */
export async function decryptSegment(data: ArrayBuffer, keyBytes: ArrayBuffer, key: HlsKey, seq: number) {
  const iv = new Uint8Array(16)
  if (key.iv) {
    const hex = key.iv.replace(/^0x/i, '').padStart(32, '0')
    for (let index = 0; index < 16; index += 1) iv[index] = parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  } else {
    new DataView(iv.buffer).setUint32(12, seq)
  }
  const cryptoKey = await crypto.subtle.importKey('raw', keyBytes, 'AES-CBC', false, ['decrypt'])
  return crypto.subtle.decrypt({ name: 'AES-CBC', iv }, cryptoKey, data)
}
