import { defineConfig } from 'vite'

// Gera o gravador do PC (server/local/main.ts) como um unico arquivo Node.
export default defineConfig({
  build: {
    ssr: 'server/local/main.ts',
    outDir: 'server/dist',
    emptyOutDir: true,
    target: 'node20',
    minify: false,
    rollupOptions: {
      output: { entryFileNames: 'local.mjs', format: 'es' },
    },
  },
})
