import { useEffect, useRef, useState } from 'react'
import { useScreenData } from '../lib/useScreenData'
import { useLocation, useNavigate } from 'react-router-dom'
import jsQR from 'jsqr'
import { IconScan, IconDoc } from '../components/icons'

type CamState = 'starting' | 'live' | 'denied' | 'unavailable'

/** 伝票QRの中身。gen_qr.py が入れている3項目 */
interface SlipPayload {
  item?: string
  receiver?: string
  tracking_no?: string
}

/** JSONでなければ何も取り出さない(別のQRを読んだ場合) */
function parseSlip(text: string): SlipPayload | null {
  try {
    const o = JSON.parse(text) as SlipPayload
    if (typeof o !== 'object' || o === null) return null
    if (!o.item && !o.receiver && !o.tracking_no) return null
    return o
  } catch {
    return null
  }
}

/**
 * 伝票QRコード読み取り画面。
 * 搬送依頼入力画面から来て、読み取れたら自動で戻る。
 * 戻った時点で荷物名・受取人・送り状番号に値が入っている。
 * 読み取れないときはキャンセルで戻り、入力画面で手入力する。
 */
export function SlipScan() {
  useScreenData()
  const navigate = useNavigate()
  const location = useLocation()
  const form = (location.state as { form?: Record<string, unknown> } | null)?.form

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number>(0)
  const [cam, setCam] = useState<CamState>('starting')
  // 権限は得たが video.play() が拒まれた(自動再生を許さないブラウザ)。人の操作で再生する
  const [needsTap, setNeedsTap] = useState(false)
  // 拒まれた理由(NotAllowedError / NotFoundError など)。現場での切り分け用に出す
  const [camError, setCamError] = useState('')
  const [wrongQr, setWrongQr] = useState(false)

  const stopCamera = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }

  /** 入力画面へ戻る。slip があれば3項目を入れて返す */
  const back = (slip?: SlipPayload) => {
    stopCamera()
    const filled = slip
      ? {
          ...(form ?? {}),
          itemName: slip.item ?? (form?.itemName as string) ?? '',
          recipient: slip.receiver ?? (form?.recipient as string) ?? '',
          trackingNo: slip.tracking_no ?? (form?.trackingNo as string) ?? '',
        }
      : form
    navigate('/request', { replace: true, state: filled ? { form: filled } : undefined })
  }

  useEffect(() => {
    let cancelled = false

    const scanLoop = () => {
      const video = videoRef.current
      const canvas = canvasRef.current
      if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (ctx) {
          canvas.width = video.videoWidth
          canvas.height = video.videoHeight
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height)
          const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })
          if (code && code.data) {
            const slip = parseSlip(code.data)
            if (slip) {
              back(slip)
              return
            }
            setWrongQr(true) // 伝票以外のQR。読み続ける
          }
        }
      }
      rafRef.current = requestAnimationFrame(scanLoop)
    }

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCam('unavailable')
        return
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          // play() が拒まれると画面は真っ黒のまま。黙って続けず、人に押してもらう
          const played = await videoRef.current.play().then(() => true, () => false)
          if (!played) setNeedsTap(true)
        }
        setCam('live')
        rafRef.current = requestAnimationFrame(scanLoop)
      } catch (e) {
        setCamError(e instanceof Error ? e.name : String(e))
        setCam('denied')
      }
    }

    start()
    return () => {
      cancelled = true
      stopCamera()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="fade-in">
      <div className="page-head">
        <h1>伝票QRコード読み取り</h1>
        <p>伝票のQRコードをカメラにかざしてください</p>
      </div>

      {cam === 'live' || cam === 'starting' ? (
        <div className="scanner">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            onLoadedMetadata={(e) => {
              // srcObject を付けた直後の play() が早すぎるブラウザ向けに、メタデータが来たらもう一度
              void e.currentTarget.play().then(
                () => setNeedsTap(false),
                () => setNeedsTap(true),
              )
            }}
          />
          {needsTap && (
            <button
              className="btn btn-primary"
              style={{ position: 'absolute', left: '10%', right: '10%', top: '45%' }}
              onClick={() => {
                void videoRef.current?.play().then(
                  () => setNeedsTap(false),
                  () => setNeedsTap(true),
                )
              }}
            >
              タップしてカメラを開始
            </button>
          )}
          <div className="scan-frame">
            <div className="scan-corner tl" />
            <div className="scan-corner tr" />
            <div className="scan-corner bl" />
            <div className="scan-corner br" />
            <div className="scan-line" />
          </div>
          <div className="scan-hint">
            {cam === 'starting' ? 'カメラを起動しています…' : 'QRコードを枠内に合わせてください'}
          </div>
        </div>
      ) : (
        <div className="card card-pad" style={{ textAlign: 'center' }}>
          <div
            style={{
              width: 56,
              height: 56,
              margin: '4px auto 10px',
              borderRadius: 16,
              background: 'var(--grey-tint)',
              color: 'var(--navy-faint)',
              display: 'grid',
              placeItems: 'center',
            }}
          >
            <IconScan size={28} />
          </div>
          <div style={{ fontWeight: 700 }}>
            {cam === 'denied' ? 'カメラを利用できません' : 'この環境ではカメラが使えません'}
          </div>
          {camError && (
            <div className="muted mono" style={{ fontSize: 11, marginTop: 2 }}>
              {camError}
            </div>
          )}
          <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            キャンセルで戻り、搬送依頼画面で荷物名と受取人を手入力してください
          </p>
        </div>
      )}

      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {wrongQr && (
        <div className="card card-pad" style={{ marginTop: 12, borderLeft: '4px solid var(--orange)' }}>
          <div style={{ fontWeight: 700, fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 8 }}>
            <IconDoc size={17} /> 伝票のQRコードではありません
          </div>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
            伝票に印刷されたQRコードをかざしてください
          </p>
        </div>
      )}

      <button className="btn btn-ghost" style={{ marginTop: 14 }} onClick={() => back()}>
        キャンセル
      </button>
    </div>
  )
}
