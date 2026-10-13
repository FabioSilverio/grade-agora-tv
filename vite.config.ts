import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// @ts-expect-error modulo JS sem tipos, compartilhado com a funcao da Vercel
import { proxyNodeRequest } from './server/node-adapter.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'iptv-dev-proxy',
      configureServer(server) {
        server.middlewares.use('/api/proxy', (req, res) => {
          req.url = `/api/proxy${req.url ?? ''}`
          void proxyNodeRequest(req, res, { allowPrivateHosts: true })
        })
      },
      configurePreviewServer(server) {
        server.middlewares.use('/api/proxy', (req, res) => {
          req.url = `/api/proxy${req.url ?? ''}`
          void proxyNodeRequest(req, res, { allowPrivateHosts: true })
        })
      },
    },
  ],
  worker: {
    format: 'es',
  },
  build: {
    // hls.js sozinho tem ~500 kB e ja e carregado sob demanda
    chunkSizeWarningLimit: 600,
  },
})
