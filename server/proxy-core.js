// Proxy de streaming usado pelo player IPTV.
// Servidores IPTV quase nunca mandam cabecalhos CORS e costumam ser http://,
// o que o navegador bloqueia numa pagina https (Vercel). Este proxy repassa a
// requisicao, libera CORS e reescreve playlists HLS para URLs absolutas.
//
// Mesmo codigo roda na Vercel (api/proxy.js), no `vite dev` e no proxy local
// opcional (server/local-proxy.mjs).

const DEFAULT_UA = 'VLC/3.0.21 LibVLC/3.0.21'
const PLAYLIST_SNIFF_LIMIT = 3 * 1024 * 1024
const CONNECT_TIMEOUT_MS = 25_000

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Range, Content-Type',
  'Access-Control-Allow-Private-Network': 'true',
  'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Content-Type, X-Final-Url',
}

const PASS_RESPONSE_HEADERS = ['content-type', 'content-range', 'accept-ranges', 'last-modified', 'etag']

/**
 * @param {Request} request
 * @param {{ allowPrivateHosts?: boolean, allowCrossSite?: boolean }} [options]
 */
export async function handleProxy(request, options = {}) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })

  // Impede que outros sites usem este proxy (o navegador manda Sec-Fetch-Site em toda requisicao).
  const allowCrossSite = options.allowCrossSite ?? globalThis.process?.env?.PROXY_ALLOW_CROSS_SITE === '1'
  if (!allowCrossSite && request.headers.get('sec-fetch-site') === 'cross-site') {
    return errorResponse(403, 'Proxy disponivel apenas para este site.')
  }

  const params = new URL(request.url).searchParams
  const target = params.get('url')
  if (!target) return errorResponse(400, 'Parametro url ausente.')

  let targetUrl
  try {
    targetUrl = new URL(target)
  } catch {
    return errorResponse(400, 'URL invalida.')
  }
  if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') return errorResponse(400, 'Somente http/https.')
  if (!options.allowPrivateHosts && isPrivateHost(targetUrl.hostname)) return errorResponse(403, 'Host privado bloqueado.')

  const headers = new Headers({
    'User-Agent': params.get('ua') || DEFAULT_UA,
    Accept: '*/*',
  })
  const referer = params.get('ref')
  if (referer) headers.set('Referer', referer)
  const range = request.headers.get('range')
  if (range) headers.set('Range', range)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('timeout')), CONNECT_TIMEOUT_MS)
  request.signal?.addEventListener('abort', () => controller.abort(request.signal.reason))

  let upstream
  try {
    upstream = await fetch(targetUrl, {
      method: request.method === 'HEAD' ? 'HEAD' : 'GET',
      headers,
      redirect: 'follow',
      signal: controller.signal,
    })
  } catch (error) {
    clearTimeout(timer)
    const message = error instanceof Error ? error.message : String(error)
    return errorResponse(502, `Falha ao conectar no servidor IPTV: ${message}`)
  }
  clearTimeout(timer)

  const finalUrl = upstream.url || targetUrl.href
  const responseHeaders = new Headers(CORS_HEADERS)
  responseHeaders.set('X-Final-Url', finalUrl)
  responseHeaders.set('Cache-Control', 'no-store')
  for (const name of PASS_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name)
    if (value) responseHeaders.set(name, value)
  }
  // fetch() ja descompacta gzip/br; nesse caso o content-length original nao vale mais.
  const length = upstream.headers.get('content-length')
  if (length && !upstream.headers.get('content-encoding')) responseHeaders.set('Content-Length', length)

  if (!upstream.body || request.method === 'HEAD') {
    return new Response(null, { status: upstream.status, headers: responseHeaders })
  }

  const contentType = upstream.headers.get('content-type') || ''
  const maybePlaylist = /mpegurl|x-mpeg|vnd\.apple/i.test(contentType) || /\.m3u8?($|\?)/i.test(finalUrl)
  if (!maybePlaylist) {
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders })
  }

  // Le ate PLAYLIST_SNIFF_LIMIT. Se for playlist HLS, reescreve; senao (ex.: lista M3U
  // gigante) devolve o que ja foi lido seguido do resto do stream, sem bufferizar tudo.
  const reader = upstream.body.getReader()
  const chunks = []
  let size = 0
  let overflow = false
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    size += value.byteLength
    if (size > PLAYLIST_SNIFF_LIMIT) {
      overflow = true
      break
    }
  }

  if (overflow) {
    const body = new ReadableStream({
      start(ctrl) {
        for (const chunk of chunks) ctrl.enqueue(chunk)
      },
      async pull(ctrl) {
        const { done, value } = await reader.read()
        if (done) ctrl.close()
        else ctrl.enqueue(value)
      },
      cancel(reason) {
        return reader.cancel(reason)
      },
    })
    return new Response(body, { status: upstream.status, headers: responseHeaders })
  }

  let text = new TextDecoder().decode(concat(chunks, size))
  if (/#EXT-X-(TARGETDURATION|STREAM-INF|MEDIA-SEQUENCE|MAP|KEY)/.test(text)) {
    text = rewriteHlsPlaylist(text, finalUrl)
    responseHeaders.set('Content-Type', 'application/vnd.apple.mpegurl')
  }
  responseHeaders.delete('Content-Length')
  return new Response(text, { status: upstream.status, headers: responseHeaders })
}

/** Torna absolutas todas as URIs da playlist (linhas de segmento e atributos URI="..."). */
export function rewriteHlsPlaylist(text, baseUrl) {
  const absolute = (uri) => {
    try {
      return new URL(uri, baseUrl).href
    } catch {
      return uri
    }
  }

  return text
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim()
      if (!trimmed) return line
      if (trimmed.startsWith('#')) {
        return line.replace(/URI="([^"]+)"/g, (_, uri) => `URI="${absolute(uri)}"`)
      }
      return absolute(trimmed)
    })
    .join('\n')
}

function concat(chunks, size) {
  const out = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return out
}

function isPrivateHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return true
  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) return true
  const ipv4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (!ipv4) return false
  const [a, b] = [Number(ipv4[1]), Number(ipv4[2])]
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  )
}

function errorResponse(status, message) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}
