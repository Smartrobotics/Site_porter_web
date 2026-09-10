import type { Person, Cart } from './types'

/** サンプル人員リスト(受取人選択用) */
export const SAMPLE_PEOPLE: Person[] = [
  { id: 'p1', name: '田中 健一', role: '現場監督' },
  { id: 'p2', name: '佐藤 美和', role: '設備業者' },
  { id: 'p3', name: '鈴木 大輔', role: '電気工事' },
  { id: 'p4', name: '高橋 由紀', role: '内装業者' },
  { id: 'p5', name: '渡辺 誠', role: '安全管理者' },
]

/** 初期荷台データ(マーカーIDはユーザーが変更可能) */
export const INITIAL_CARTS: Cart[] = [
  { id: 'cart-01', label: '荷台 No.1', markerId: '1', spotId: 'a-hall2' },
  { id: 'cart-02', label: '荷台 No.2', markerId: '2', spotId: 'a-office2' },
  { id: 'cart-03', label: '荷台 No.3', markerId: '3' },
]
