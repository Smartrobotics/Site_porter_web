import fs from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// certs/ に鍵があれば HTTPS で起動する。無ければ HTTP のまま起動する。
// スマホのカメラで QR を読むには HTTPS が必須（README 4章）
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
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port: 5173,
      https: hasCert
        ? { key: fs.readFileSync(KEY), cert: fs.readFileSync(CERT) }
        : undefined,

      // Docker のバインドマウントで変更が検知されない場合に必要
      watch: { usePolling: true },

      proxy: {
        // /api は backend コンテナへ転送する。コンテナ間なので http でよい
        '/api': {
          target: 'http://backend:8000',
          changeOrigin: true,
        },
      },
    },
  }
})
