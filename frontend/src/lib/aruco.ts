import { AR, type ArucoMarker } from 'js-aruco2'

/**
 * 荷台の ArUco マーカーを読む。
 *
 * ロボット側と同じ辞書 ARUCO_MIP_36h12 (aruco_ros marker_publisher、
 * AMR_AR_PrecisePositioning/marker_image のカタログ)。ID はマーカー自体に
 * 入っているので、画像を候補と照合する必要はない。
 *
 * 誤検出対策は2段:
 *   - ハミング距離の上限を辞書既定の 12 から 4 に絞る。ロボット側でも
 *     小さく写ったマーカーが存在しない ID (1008) に化けた実績がある
 *   - 同じ ID が続けて STABLE_FRAMES 回見えたときだけ確定する (呼び出し側)
 */
const DICTIONARY = 'ARUCO_MIP_36h12'
const MAX_HAMMING = 4

export const STABLE_FRAMES = 3

export function createArucoDetector() {
  const detector = new AR.Detector({ dictionaryName: DICTIONARY, maxHammingDistance: MAX_HAMMING })
  return {
    /** 1フレーム分。見つからなければ空配列。最も確からしいものが先頭 */
    detect(img: ImageData): ArucoMarker[] {
      const found = detector.detect({ width: img.width, height: img.height, data: img.data })
      return found.sort((a, b) => a.hammingDistance - b.hammingDistance)
    },
  }
}

/**
 * 連続フレームで同じ ID が見えたかを数える。
 * 1フレームだけの一致は捨てる: 手ぶれや反射で一瞬だけ別の ID に読めることがある。
 */
export function createStableVote(frames = STABLE_FRAMES) {
  let lastId: number | null = null
  let count = 0
  return {
    /** このフレームの読み取り結果を入れ、確定した ID か null を返す */
    push(id: number | null): number | null {
      if (id === null || id !== lastId) {
        lastId = id
        count = id === null ? 0 : 1
        return null
      }
      count += 1
      return count >= frames ? id : null
    },
  }
}
