import { useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'

// カメラが使えない理由ごとのメッセージ。
// まとめて「カメラが使えません」にすると原因が分からなくなるので分けている。
const MESSAGES = {
  insecure:
    'カメラを使うには HTTPS での接続が必要です。https:// で始まるURLで開き直してください。',
  unsupported: 'このブラウザはカメラに対応していません。',
  NotAllowedError:
    'カメラの使用が許可されませんでした。ブラウザの設定でこのサイトのカメラを許可してください。',
  NotFoundError: 'カメラが見つかりませんでした。',
  NotReadableError:
    'カメラを起動できませんでした。他のアプリがカメラを使用している可能性があります。',
  OverconstrainedError: '条件に合うカメラが見つかりませんでした。',
  default: 'カメラを起動できませんでした。',
}

// jsQR は解像度が高いほど重くなるので、この幅に縮めてから解析する
const SCAN_WIDTH = 640

export default function QrScanner({ onDetect, onClose }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const onDetectRef = useRef(onDetect)
  const [error, setError] = useState(null)
  const [ready, setReady] = useState(false)

  // 毎フレーム参照するコールバックを最新に保つ（effect を再実行させないため）
  useEffect(() => {
    onDetectRef.current = onDetect
  }, [onDetect])

  useEffect(() => {
    let stream = null
    let raf = 0
    let stopped = false
    let detector = null

    function scanWithCanvas(video) {
      const scale = Math.min(1, SCAN_WIDTH / video.videoWidth)
      const w = Math.round(video.videoWidth * scale)
      const h = Math.round(video.videoHeight * scale)

      const canvas = canvasRef.current
      canvas.width = w
      canvas.height = h

      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      ctx.drawImage(video, 0, 0, w, h)

      const image = ctx.getImageData(0, 0, w, h)
      const code = jsQR(image.data, w, h, { inversionAttempts: 'dontInvert' })
      return code?.data || null
    }

    async function tick() {
      if (stopped) return

      const video = videoRef.current
      if (video && video.readyState === video.HAVE_ENOUGH_DATA && video.videoWidth) {
        let text = null

        if (detector) {
          // ブラウザ内蔵の検出器（iOS 17+ / Chrome）。あるほうが速く電池も持つ
          try {
            const codes = await detector.detect(video)
            if (codes.length > 0) text = codes[0].rawValue
          } catch {
            detector = null // 失敗したら jsQR に切り替える
          }
        } else {
          text = scanWithCanvas(video)
        }

        if (text) {
          onDetectRef.current(text)
          return // 読み取れたらループを止める
        }
      }

      raf = requestAnimationFrame(tick)
    }

    async function start() {
      // http:// で開いている場合はここで止まる（localhost は例外的に secure 扱い）
      if (!window.isSecureContext) {
        setError(MESSAGES.insecure)
        return
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(MESSAGES.unsupported)
        return
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          // 背面カメラを優先。指定しないと前面が起動してQRを写せない
          video: { facingMode: { ideal: 'environment' } },
        })
      } catch (e) {
        setError(MESSAGES[e.name] || MESSAGES.default)
        return
      }

      // 許可ダイアログの間に閉じられた場合の後始末
      if (stopped) {
        stream.getTracks().forEach((t) => t.stop())
        return
      }

      const video = videoRef.current
      video.srcObject = stream
      try {
        await video.play()
      } catch {
        setError(MESSAGES.default)
        return
      }
      setReady(true)

      if ('BarcodeDetector' in window) {
        try {
          detector = new window.BarcodeDetector({ formats: ['qr_code'] })
        } catch {
          detector = null
        }
      }

      tick()
    }

    start()

    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
      if (videoRef.current) videoRef.current.srcObject = null
    }
  }, [])

  return (
    <div className="scanner">
      <div className="scanner-head">
        <span>QRコードを読み取る</span>
        <button onClick={onClose}>閉じる</button>
      </div>

      {error ? (
        <p className="error">{error}</p>
      ) : (
        <div className="scanner-view">
          {/* playsInline と muted が無いと iOS Safari で再生されない */}
          <video ref={videoRef} playsInline muted />
          {!ready && <p className="muted">カメラを起動しています…</p>}
        </div>
      )}

      <canvas ref={canvasRef} hidden />
    </div>
  )
}
