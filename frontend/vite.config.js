import fs from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// certs/ に鍵があれば HTTPS で起動する。
// 無い場合は HTTP のまま起動する（PCの localhost で触るだけなら足りる）。
// スマホのカメラで QR を読むには HTTPS が必須。README の「HTTPS にする」を参照。
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
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port: 5173,
      https: hasCert
        ? { key: fs.readFileSync(KEY), cert: fs.readFileSync(CERT) }
        : undefined,

      // ホスト名でアクセスする場合はここに追加する（IP直打ちなら不要）
      // allowedHosts: ['tasks.local'],

      // Docker のバインドマウントでファイル変更が検知されない場合に有効
      watch: { usePolling: true },

      proxy: {
        // /api へのリクエストは backend コンテナへ転送する。
        // コンテナ間の通信なので http のままでよい。
        '/api': {
          target: 'http://backend:8000',
          changeOrigin: true,
        },
      },
    },
  }
})
