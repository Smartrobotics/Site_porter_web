import { AR, type ArucoMarker } from 'js-aruco2'

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
