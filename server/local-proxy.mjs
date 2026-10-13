// Proxy local opcional: roda no seu PC e evita os limites da Vercel
// (5 min por requisicao e trafego da conta) em gravacoes longas.
//
//   npm run proxy            -> http://127.0.0.1:8787/api/proxy
//
// No Windows, scripts\windows\instalar-proxy.cmd deixa ele rodando escondido e
// iniciando junto com o Windows. Depois, em Ajustes > Proxy, use
// "http://127.0.0.1:8787/api/proxy".
import { createServer } from 'node:http'
import { proxyNodeRequest } from './node-adapter.js'

const port = Number(process.env.PORT || 8787)

const server = createServer((req, res) => {
  if (!req.url?.startsWith('/api/proxy')) {
    res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' })
    res.end('Grade Agora proxy local ativo. Use /api/proxy?url=...')
    return
  }
  void proxyNodeRequest(req, res, { allowPrivateHosts: true, allowCrossSite: true })
})

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    // Ja tem um proxy rodando nessa porta: nada a fazer.
    console.log(`Porta ${port} ja esta em uso (proxy ja ativo?).`)
    process.exit(3)
  }
  throw error
})

server.listen(port, '127.0.0.1', () => {
  console.log(`[${new Date().toISOString()}] Proxy IPTV local em http://127.0.0.1:${port}/api/proxy`)
})

// Uma requisicao com erro nao pode derrubar o proxy inteiro.
process.on('uncaughtException', (error) => console.error(`[${new Date().toISOString()}] erro:`, error))
