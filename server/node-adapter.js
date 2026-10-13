import { Readable } from 'node:stream'
import { handleProxy } from './proxy-core.js'

/**
 * Adapta (req, res) do Node para o handler Web do proxy.
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {{ allowPrivateHosts?: boolean }} [options]
 */
export async function proxyNodeRequest(req, res, options) {
  const controller = new AbortController()
  res.on('close', () => controller.abort())

  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') headers.set(key, value)
  }

  const request = new Request(new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`), {
    method: req.method,
    headers,
    signal: controller.signal,
  })

  try {
    const response = await handleProxy(request, options)
    res.writeHead(response.status, Object.fromEntries(response.headers))
    if (!response.body) {
      res.end()
      return
    }
    Readable.fromWeb(response.body)
      .on('error', () => res.destroy())
      .pipe(res)
  } catch (error) {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' })
    res.end(error instanceof Error ? error.message : 'proxy error')
  }
}
