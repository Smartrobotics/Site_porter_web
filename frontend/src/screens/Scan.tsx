import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import jsQR from 'jsqr'
import { createArucoDetector, createStableVote } from '../lib/aruco'
import { useStore } from '../domain/store'
import { IconCart, IconScan } from '../components/icons'

type CamState = 'starting' | 'live' | 'denied' | 'unavailable'

// 解析に使うフレームの幅。カメラは 1280 以上で来るが、マーカー検出は
// 1フレームごとに全画素を二値化・輪郭抽出するので、そのままではスマホで
// 数 fps に落ちる。640 でも 2〜3m 先の 4cm マーカーが読める大きさは残る
const FRAME_WIDTH = 640

/**
 * 荷台マーカーの読み取り画面。
 * 荷台には ArUco マーカー (ARUCO_MIP_36h12、ロボットと同じ辞書) が貼ってある。
 * QR も併せて読む: デモ用の印刷物や、マーカーの脇に QR を添える運用のため。
 * 搬送依頼入力画面から来て、読み取れたらそのまま入力画面へ戻す。
 * 確認画面は挟まない(読み取り後は自動で戻り、マーカーID欄に値が入る)。
 * 読み取れなければキャンセルで戻り、入力画面で手入力する。
 */
export function Scan() {
  const navigate = useNavigate()
  const location = useLocation()
  const { racks } = useStore()
  // 入力画面から預かった入力内容。戻すときにそのまま返す
  const form = (location.state as { form?: Record<string, unknown> } | null)?.form
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const rafRef = useRef<number>(0)

  const [cam, setCam] = useState<CamState>('starting')
  const [manual, setManual] = useState('')

  /** 入力画面へ戻る。value があればマーカーID欄にそれを入れる */
  const back = (value?: string) => {
    stopCamera()
    const state = form
      ? { form: value ? { ...form, markerId: value } : form }
      : value
        ? { form: { markerId: value } }
        : undefined
    navigate('/request', { replace: true, state })
  }

  const resolveMarker = (markerId: string) => {
    const id = markerId.trim()
    if (!id) return
    // 登録済みの荷台なら、その荷台を選んだことにする。
    // FormState の markerId は入力欄の値なので文字列で渡す。数値を渡すと
    // 入力画面の markerId.trim() が落ちて画面が真っ白になる
    const rack = racks.find((r) => String(r.markerId) === id)
    stopCamera()
    if (rack && form) {
      navigate('/request', {
        replace: true,
        state: { form: { ...form, rackId: rack.id, markerId: String(rack.markerId) } },
      })
      return
    }
    back(id)
  }

  const stopCamera = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }

  useEffect(() => {
    let cancelled = false
    const aruco = createArucoDetector()
    const vote = createStableVote()

    const scanLoop = () => {
      const video = videoRef.current
      const canvas = canvasRef.current
      if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (ctx) {
          const scale = Math.min(1, FRAME_WIDTH / video.videoWidth)
          canvas.width = Math.round(video.videoWidth * scale)
          canvas.height = Math.round(video.videoHeight * scale)
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height)

          // ArUco: 同じ ID が続けて見えたときだけ確定する
          const markers = aruco.detect(img)
          const stable = vote.push(markers.length ? markers[0].id : null)
          if (stable !== null) {
            resolveMarker(String(stable))
            return
          }

          const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' })
          if (code && code.data) {
            resolveMarker(code.data)
            return
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
          await videoRef.current.play().catch(() => undefined)
        }
        setCam('live')
        rafRef.current = requestAnimationFrame(scanLoop)
      } catch {
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
        <h1>マーカースキャン</h1>
        <p>荷台のマーカーをカメラにかざしてください</p>
      </div>

      {cam === 'live' || cam === 'starting' ? (
        <div className="scanner">
          <video ref={videoRef} playsInline muted />
          <div className="scan-frame">
            <div className="scan-corner tl" />
            <div className="scan-corner tr" />
            <div className="scan-corner bl" />
            <div className="scan-corner br" />
            <div className="scan-line" />
          </div>
          <div className="scan-hint">
            {cam === 'starting' ? 'カメラを起動しています…' : 'マーカーを枠内に合わせてください'}
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
          <p className="muted" style={{ fontSize: 13, marginTop: 4 }}>
            下の手入力またはデモ用の荷台選択で続行できます
          </p>
        </div>
      )}

      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {/* 手入力フォールバック */}
      <div className="section-label">IDを手入力</div>
      <div className="card card-pad">
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="input"
            placeholder="例: 1"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
          />
          <button
            className="btn btn-blue btn-sm"
            style={{ minWidth: 72 }}
            disabled={!manual.trim()}
            onClick={() => resolveMarker(manual)}
          >
            照合
          </button>
        </div>
      </div>

      <button className="btn btn-ghost" style={{ marginTop: 14 }} onClick={() => back()}>
        キャンセル(手入力で続ける)
      </button>

      {/* デモ用: 荷台を直接選択 */}
      <div className="section-label">デモ用: 荷台を選択</div>
      <div className="stack-sm">
        {racks.map((c) => (
          <button
            key={c.id}
            className="card card-pad row-between"
            style={{ width: '100%', textAlign: 'left' }}
            onClick={() => resolveMarker(String(c.markerId))}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 11,
                  background: 'var(--blue-tint)',
                  color: 'var(--blue-dark)',
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                <IconCart />
              </div>
              <div>
                <div style={{ fontWeight: 700 }}>{c.label}</div>
                <div className="muted mono" style={{ fontSize: 12 }}>
                  {c.markerId}
                </div>
              </div>
            </div>
            <span className="badge-pill badge-blue">選択</span>
          </button>
        ))}
      </div>
    </div>
  )
}
