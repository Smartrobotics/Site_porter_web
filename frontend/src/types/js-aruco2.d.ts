/**
 * js-aruco2 には型定義が無い。使う分だけ書く。
 * https://github.com/damianofalcioni/js-aruco2 (MIT)
 */
declare module 'js-aruco2' {
  export interface ArucoPoint {
    x: number
    y: number
  }

  export interface ArucoMarker {
    id: number
    corners: ArucoPoint[]
    /** 辞書の符号との距離。0 が完全一致。大きいほど誤検出の疑いが強い */
    hammingDistance: number
  }

  export interface ArucoDetectorConfig {
    dictionaryName?: 'ARUCO' | 'ARUCO_MIP_36h12' | string
    maxHammingDistance?: number
  }

  export class ArucoDetector {
    constructor(config?: ArucoDetectorConfig)
    detect(image: { width: number; height: number; data: Uint8ClampedArray }): ArucoMarker[]
  }

  // vite.config.ts のプラグインが ESM に書き換えた後の形
  export const AR: {
    Detector: typeof ArucoDetector
  }
}
