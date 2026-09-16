import { useEffect } from 'react'
import { useStore } from '../domain/store'
import { fetchWithTimeout } from './http'

/** 画面遷移時の疎通確認の待ち時間。ポーリングより短く、人が待てる長さ */
const SCREEN_CHECK_TIMEOUT_MS = 5_000

/**
 * 画面遷移時のデータ取得。
 * 失敗したら共通のモーダルを出す(共通事項:
 * 「サーバと通信できませんでした。時間をおいて再度お試しください。」)。
 *
 * 画面そのものはストアの値で描くので、ここでは GET /api/health で疎通だけ確かめる。
 * ポーリング断(E10)とは扱いが違う — あちらは何度も走るので黙って無視するが、
 * こちらは1回きりで、人が結果を待っているので知らせる必要がある。
 * 設定の「通信断」(demoOffline)は同じモーダルをサーバー無しで見せるためのもの。
 */
export function useScreenData() {
  const { demoOffline, reportScreenLoadFailed } = useStore()
  useEffect(() => {
    if (demoOffline) {
      reportScreenLoadFailed()
      return
    }
    let cancelled = false
    fetchWithTimeout('/api/health', undefined, SCREEN_CHECK_TIMEOUT_MS)
      .then((res) => {
        if (!cancelled && !res.ok) reportScreenLoadFailed()
      })
      .catch(() => {
        if (!cancelled) reportScreenLoadFailed()
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
