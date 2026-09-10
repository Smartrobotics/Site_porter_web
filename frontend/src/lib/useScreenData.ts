import { useEffect } from 'react'
import { useStore } from '../domain/store'

/**
 * 画面遷移時のデータ取得。
 * 失敗したら共通のモーダルを出す(共通事項)。
 * ポーリング断(E10)とは扱いが違う — あちらは何度も走るので黙って無視するが、
 * こちらは1回きりで、人が結果を待っているので知らせる必要がある。
 *
 * サーバーがまだないので、いまは設定の「通信断」で失敗を再現している。
 * API ができたらこの中を実際の取得に差し替える。
 */
export function useScreenData() {
  const { demoOffline, reportScreenLoadFailed } = useStore()
  useEffect(() => {
    if (demoOffline) reportScreenLoadFailed()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
