const ALLOWED_HOSTS = new Set([
  'worker-9dd4.onrender.com',
  'iptv-org.github.io',
  'raw.githubusercontent.com',
])

export default async function handler(request, response) {
  const source = request.query.url

  if (!source || typeof source !== 'string') {
    response.status(400).json({ error: 'Missing url parameter.' })
    return
  }

  let sourceUrl
  try {
    sourceUrl = new URL(source)
  } catch {
    response.status(400).json({ error: 'Invalid EPG URL.' })
    return
  }

  if (sourceUrl.protocol !== 'https:' || !ALLOWED_HOSTS.has(sourceUrl.hostname)) {
    response.status(400).json({ error: 'EPG host is not allowed.' })
    return
  }

  const upstream = await fetch(sourceUrl)
  const body = await upstream.text()
  const contentType = upstream.headers.get('content-type') || (sourceUrl.pathname.endsWith('.json') ? 'application/json' : 'application/xml')

  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=86400')
  response.setHeader('Content-Type', contentType)
  response.status(upstream.status).send(body)
}
