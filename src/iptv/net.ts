// Rede compartilhada entre a pagina e o worker de gravacao.
// Decide quando passar pelo proxy: pagina https nao pode buscar http:// (mixed
// content) e quase nenhum servidor IPTV libera CORS.

import type { ProxyMode, StreamHeaders } from './types'

export type NetConfig = {
  mode: ProxyMode
  base: string
  userAgent?: string
}

/** Hosts em que o acesso direto ja falhou nesta sessao. */
const needsProxy = new Set<string>()

export function proxify(url: string, config: NetConfig, headers?: StreamHeaders) {
  const base = new URL(config.base, self.location.href)
  base.searchParams.set('url', url)
  const ua = headers?.userAgent || config.userAgent
  if (ua) base.searchParams.set('ua', ua)
  if (headers?.referer) base.searchParams.set('ref', headers.referer)
  return base.href
}

export function isProxied(url: string, config: NetConfig) {
  return url.startsWith(new URL(config.base, self.location.href).href)
}

function hostOf(url: string) {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** true se o acesso direto nem vale tentar. */
export function mustProxy(url: string, config: NetConfig) {
  if (config.mode === 'never') return false
  if (config.mode === 'always') return true
  if (!/^https?:/i.test(url)) return false
  if (self.location.protocol === 'https:' && url.startsWith('http:')) return true
  return needsProxy.has(hostOf(url))
}

export function markNeedsProxy(url: string) {
  needsProxy.add(hostOf(url))
}

export function resolvePlayUrl(url: string, config: NetConfig, headers?: StreamHeaders) {
  return mustProxy(url, config) ? proxify(url, config, headers) : url
}

export class HttpError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/**
 * fetch que tenta direto e, no modo auto, cai para o proxy em erro de rede/CORS.
 * Retorna tambem a URL final real (apos redirecionamentos), mesmo via proxy.
 */
export async function smartFetch(
  url: string,
  config: NetConfig,
  init: RequestInit & { headers?: Record<string, string> } = {},
  streamHeaders?: StreamHeaders,
): Promise<{ response: Response; finalUrl: string }> {
  if (!mustProxy(url, config)) {
    try {
      const response = await fetch(url, init)
      return { response, finalUrl: response.url || url }
    } catch (error) {
      if (config.mode === 'never' || (error instanceof DOMException && error.name === 'AbortError')) throw error
      markNeedsProxy(url)
    }
  }
  const response = await fetch(proxify(url, config, streamHeaders), init)
  return { response, finalUrl: response.headers.get('X-Final-Url') || url }
}

export async function fetchText(url: string, config: NetConfig, signal?: AbortSignal, headers?: StreamHeaders) {
  const { response, finalUrl } = await smartFetch(url, config, { signal }, headers)
  if (!response.ok) throw new HttpError(response.status, await errorText(response))
  return { text: await response.text(), finalUrl }
}

export async function fetchJson<T>(url: string, config: NetConfig, signal?: AbortSignal): Promise<T> {
  const { text } = await fetchText(url, config, signal)
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error('Resposta invalida do servidor (nao e JSON).')
  }
}

async function errorText(response: Response) {
  let detail = ''
  try {
    const body = await response.text()
    detail = body.startsWith('{') ? (JSON.parse(body).error ?? '') : body.slice(0, 120)
  } catch {
    // ignore
  }
  return `HTTP ${response.status}${detail ? `: ${detail}` : ''}`
}

/** Descompacta gzip quando o arquivo comeca com a assinatura 1f 8b. */
export async function maybeGunzip(stream: ReadableStream<Uint8Array>): Promise<ReadableStream<Uint8Array>> {
  const reader = stream.getReader()
  const first = await reader.read()
  const rest = new ReadableStream<Uint8Array>({
    start(controller) {
      if (first.done) controller.close()
      else controller.enqueue(first.value)
    },
    async pull(controller) {
      const { done, value } = await reader.read()
      if (done) controller.close()
      else controller.enqueue(value)
    },
    cancel(reason) {
      return reader.cancel(reason)
    },
  })
  const bytes = first.value
  if (bytes && bytes[0] === 0x1f && bytes[1] === 0x8b) {
    return rest.pipeThrough(new DecompressionStream('gzip') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>)
  }
  return rest
}
