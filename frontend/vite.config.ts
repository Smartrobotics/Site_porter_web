import fs from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * js-aruco2 (荷台の ArUco マーカー読み取り) は古い書き方で、
 * `this.AR = AR` と `require('./cv')` でエクスポートしている。
 * Vite の事前バンドル(esbuild)はこれを ESM とみなして top-level の this を
 * undefined に置き換えるため、そのままでは読み込んだ瞬間に落ちる。
 * 2ファイルだけなので、ここで ESM に書き換えて渡す。
 */
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
    plugins: [react(), jsAruco2AsEsm()],
    optimizeDeps: {
      // 上のプラグインを通すため事前バンドルから外す
      exclude: ['js-aruco2'],
    },
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
          // backend が落ちていると proxy は接続を待ち続け、ブラウザには何も返さない。
          // 5 秒で 504 を返して、画面側が「通信できない」と判断できるようにする
          proxyTimeout: 5000,
          timeout: 10000,
          // backend コンテナが止まっていると DNS(getaddrinfo EAI_AGAIN)に 5 秒かかり、
          // その後もブラウザへ応答が返らないことがあった。失敗したら必ず 502 を返す
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
