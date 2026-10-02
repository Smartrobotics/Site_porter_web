import fs from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

function jsAruco2AsEsm(): Plugin {
  return {
    name: 'js-aruco2-as-esm',
    enforce: 'pre',
    transform(code, id) {
      if (id.includes('/js-aruco2/src/cv.js')) {
        return code.replace('this.CV = CV;', 'export { CV };')
      }
      if (id.includes('/js-aruco2/src/aruco.js')) {
        return code
          .replace("var CV = this.CV || require('./cv').CV;", "import { CV } from './cv.js';")
          .replace('this.AR = AR;', 'export { AR };')
      }
      return null
    },
  }
}

const KEY = './certs/key.pem'
const CERT = './certs/cert.pem'
const hasCert = fs.existsSync(KEY) && fs.existsSync(CERT)

export default defineConfig(({ command }) => {
  if (command === 'serve' && !hasCert) {
    console.warn(
      '\n[vite] certs/ が無いため HTTP で起動します。スマホのカメラを使うには証明書が必要です。\n'
    )
  }

  return {
    base: './',
    plugins: [react(), jsAruco2AsEsm()],
    optimizeDeps: {
      exclude: ['js-aruco2'],
    },
    server: {
      host: '0.0.0.0',
      port: 5173,
      https: hasCert
        ? { key: fs.readFileSync(KEY), cert: fs.readFileSync(CERT) }
        : undefined,

      watch: { usePolling: true },

      proxy: {
        '/api': {
          target: 'http://backend:8000',
          changeOrigin: true,
          proxyTimeout: 5000,
          timeout: 10000,
          configure(proxy) {
            proxy.on('error', (_err, _req, res) => {
              const r = res as import('node:http').ServerResponse
              if (typeof r.writeHead === 'function' && !r.headersSent && !r.writableEnded) {
                r.writeHead(502, { 'Content-Type': 'application/json' })
                r.end(JSON.stringify({ detail: 'backend unavailable' }))
              }
            })
          },
        },
      },
    },
  }
})
