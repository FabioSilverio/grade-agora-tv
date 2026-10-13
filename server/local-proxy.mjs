// Proxy local opcional: roda no seu PC e evita os limites da Vercel
// (5 min por requisicao e trafego da conta) em gravacoes longas.
//
//   npm run proxy            -> http://localhost:8787/api/proxy
//
// Depois, em Ajustes > Proxy, use "http://localhost:8787/api/proxy".
import { createServer } from 'node:http'
import { proxyNodeRequest } from './node-adapter.js'

const port = Number(process.env.PORT || 8787)

createServer((req, res) => {
  if (!req.url?.startsWith('/api/proxy')) {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' })
    res.end('Grade Agora proxy local ativo. Use /api/proxy?url=...')
    return
  }
  void proxyNodeRequest(req, res, { allowPrivateHosts: true, allowCrossSite: true })
}).listen(port, '127.0.0.1', () => {
  console.log(`Proxy IPTV local em http://localhost:${port}/api/proxy`)
})
