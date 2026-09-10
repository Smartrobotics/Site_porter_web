import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { TransportRequest, TransportTask } from './types'
import { PRIORITY_TO_DB } from './types'
import {
  EMPTY_MASTER,
  findArea,
  freeAddressesInArea,
  toAddress,
  toArea,
  toRack,
  toUser,
  type Address,
  type Area,
  type Master,
  type Rack,
  type User,
} from './master'
import { toTask, type RequestRaw } from './mapping'
import { createRobotAdapter, type RobotConfig } from '../robot'

const STORAGE_KEY = 'siteporter.state.v4'
/** 搬送状況のポーリング間隔 */
const POLL_MS = 3000

/**
 * localStorage に残すのは端末ごとの事情だけ。
 * 依頼・荷台・エリアはサーバーが持つ唯一の正しい値なので保存しない。
 */
interface PersistState {
  /** 現在地。壁QRで読んだエリア */
  currentAreaId?: number
  robotConfig: RobotConfig
  /** デモ用。搬送依頼の送信を必ず失敗させ、エラーモーダルを見せるための設定 */
  demoError: DemoError
  /** デモ用。true の間はポーリングが失敗し続ける(E10 の再現) */
  demoOffline: boolean
}

/**
 * none = 何も起こさない
 * e6 / e8 = モーダルを出して受付を断る
 *
 * E7(搬送先に空き場所がない)と E9(ロボットが実行中)はサーバー側で本当に起きるので、
 * 再現用の設定は持たない。番地を全部埋めれば E7、搬送中に依頼を足せば E9。
 */
export type DemoError = 'none' | 'e6' | 'e8'

/** 画面遷移時にサーバーと通信できなかったときの共通メッセージ */
export const SCREEN_LOAD_ERROR = 'サーバと通信できませんでした。時間をおいて再度お試しください。'

export const DEMO_ERROR_MESSAGE: Record<'e6' | 'e8', string> = {
  e6: 'サーバーに接続できませんでした。時間をおいて再度お試しください。',
  e8: '指定された荷台は使用中です。別の荷台を選んでください。',
}

const initialState: PersistState = {
  currentAreaId: undefined,
  robotConfig: { kind: 'mock', atmobiUrl: 'http://localhost:5000' },
  demoError: 'none',
  demoOffline: false,
}

function loadState(): PersistState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return initialState
    return { ...initialState, ...(JSON.parse(raw) as Partial<PersistState>) }
  } catch {
    return initialState
  }
}

type Action =
  | { type: 'SET_CURRENT_AREA'; areaId?: number }
  | { type: 'SET_ROBOT_CONFIG'; config: RobotConfig }
  | { type: 'SET_DEMO_ERROR'; value: DemoError }
  | { type: 'SET_DEMO_OFFLINE'; value: boolean }

function reducer(state: PersistState, action: Action): PersistState {
  switch (action.type) {
    case 'SET_CURRENT_AREA':
      return { ...state, currentAreaId: action.areaId }
    case 'SET_ROBOT_CONFIG':
      return { ...state, robotConfig: action.config }
    case 'SET_DEMO_ERROR':
      return { ...state, demoError: action.value }
    case 'SET_DEMO_OFFLINE':
      return { ...state, demoOffline: action.value }
    default:
      return state
  }
}

export interface Toast {
  id: string
  title: string
  body: string
  kind: 'completed' | 'info' | 'error'
}

interface StoreContextValue extends PersistState {
  /** サーバーから取得したマスタ */
  master: Master
  areas: Area[]
  addresses: Address[]
  racks: Rack[]
  users: User[]
  masterLoaded: boolean
  /** 搬送依頼。サーバーが唯一の正しい値。ポーリングで取り直す */
  tasks: TransportTask[]
  /** 現在地のエリア(未設定/未登録なら undefined。E1-2 / E1-3) */
  currentArea: Area | undefined
  toasts: Toast[]
  /** 受取確認が済んでいない搬送の件数(通知タブのバッジ) */
  pendingReceiptCount: number
  robotAdapterName: string
  // actions
  setCurrentArea: (areaId?: number) => void
  /** 荷台の置き場所を変える。サーバーへの反映は未実装(PATCH /api/rack) */
  updateRack: (rack: Rack) => void
  setRobotConfig: (config: RobotConfig) => void
  setDemoError: (value: DemoError) => void
  setDemoOffline: (value: boolean) => void
  /** 画面遷移時の取得に失敗した(共通モーダルを出す) */
  screenError: string | null
  reportScreenLoadFailed: () => void
  dismissScreenError: () => void
  /** 最後にポーリングが成功した時刻。失敗しても更新しない(E10) */
  lastFetchedAt: number
  startTransport: (req: TransportRequest) => Promise<number>
  cancelTask: (id: number) => Promise<void>
  cancelRequest: (id: number, mode: 'delete' | 'reset') => Promise<void>
  /** 受取人が荷物を受け取ったことを確認する */
  confirmReceipt: (taskId: number) => void
  dismissToast: (id: string) => void
  checkRobotConnection: (config: RobotConfig) => Promise<{ ok: boolean; detail: string }>
}

const StoreContext = createContext<StoreContextValue | null>(null)

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

/** 失敗したらサーバーが返した文面をそのまま投げる。E6 / E8 のモーダルに出る */
async function send(path: string, body?: unknown): Promise<RequestRaw> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const detail = data && typeof data.detail === 'string' ? data.detail : `${path} -> ${res.status}`
    throw new Error(detail)
  }
  return data as RequestRaw
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadState)
  const [master, setMaster] = useState<Master>(EMPTY_MASTER)
  const [masterLoaded, setMasterLoaded] = useState(false)
  const [raws, setRaws] = useState<RequestRaw[]>([])
  const [toasts, setToasts] = useState<Toast[]>([])
  // ポーリングが最後に成功した時刻。失敗しても更新しない(E10)
  const [lastFetchedAt, setLastFetchedAt] = useState(Date.now())
  // 画面遷移時の取得失敗。ポーリング断(E10)と違い、こちらは黙らずに知らせる
  const [screenError, setScreenError] = useState<string | null>(null)

  const offlineRef = useRef(state.demoOffline)
  offlineRef.current = state.demoOffline

  const pushToast = (t: Omit<Toast, 'id'>) => {
    const toast: Toast = { ...t, id: uid('toast') }
    setToasts((prev) => [...prev, toast])
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== toast.id))
    }, 5000)
  }

  const dismissToast = (id: string) => setToasts((prev) => prev.filter((x) => x.id !== id))

  /** 依頼を取り直す。成功したときだけ時刻を進める */
  const refresh = useCallback(async () => {
    if (offlineRef.current) return
    try {
      const res = await fetch('/api/request')
      if (!res.ok) throw new Error(String(res.status))
      setRaws(await res.json())
      setLastFetchedAt(Date.now())
    } catch {
      // E10: ポーリング断はエラーを出さない。取得時刻が止まることで人に伝わる
    }
  }, [])

  // マスタの取得。起動時に一度だけ
  useEffect(() => {
    let cancelled = false
    const get = async (path: string) => {
      const res = await fetch(path)
      if (!res.ok) throw new Error(`${path} -> ${res.status}`)
      return res.json()
    }
    const load = async () => {
      try {
        const [a, ad, rk, us] = await Promise.all([
          get('/api/area'),
          get('/api/address'),
          get('/api/rack'),
          get('/api/user'),
        ])
        if (cancelled) return
        setMaster({
          areas: a.map(toArea),
          addresses: ad.map(toAddress),
          racks: rk.map(toRack),
          users: us.map(toUser),
        })
        setMasterLoaded(true)
      } catch {
        if (!cancelled) setScreenError(SCREEN_LOAD_ERROR)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  // 搬送状況のポーリング
  useEffect(() => {
    void refresh()
    const t = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(t)
  }, [refresh])

  // 永続化
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      /* ignore quota errors */
    }
  }, [state])

  // ロボット接続テスト用。搬送そのものはサーバーが走らせる
  const adapter = useMemo(() => createRobotAdapter(state.robotConfig), [state.robotConfig])

  const tasks = useMemo(
    () =>
      raws.map((r) =>
        toTask(r, r.status === 'queued' && freeAddressesInArea(master, r.to_area_id).length === 0),
      ),
    [raws, master],
  )

  const startTransport = async (req: TransportRequest): Promise<number> => {
    // E6 / E8 はデモ用。サーバーまで行かせずにモーダルを出す
    if (state.demoError !== 'none') {
      throw new Error(DEMO_ERROR_MESSAGE[state.demoError])
    }
    const created = await send('/api/request', {
      rack_id: req.rackId,
      from_area_id: req.fromAreaId,
      to_area_id: req.toAreaId,
      item: req.itemName || null,
      receiver_name: req.recipient || null,
      tracking_no: req.trackingNo || null,
      priority: PRIORITY_TO_DB[req.priority],
    })
    await refresh()
    return created.id
  }

  const cancelRequest = async (id: number, mode: 'delete' | 'reset') => {
    try {
      await send(`/api/request/${id}/cancel`, { mode })
    } catch (e) {
      pushToast({
        title: '取消できませんでした',
        body: e instanceof Error ? e.message : '',
        kind: 'error',
      })
    }
    await refresh()
  }

  const cancelTask = async (id: number) => {
    try {
      await send(`/api/request/${id}/cancel`, { mode: 'abort' })
    } catch (e) {
      pushToast({
        title: '中止できませんでした',
        body: e instanceof Error ? e.message : '',
        kind: 'error',
      })
    }
    await refresh()
  }

  const confirmReceipt = (taskId: number) => {
    void (async () => {
      try {
        await send(`/api/request/${taskId}/confirm`)
      } catch (e) {
        pushToast({
          title: '受取確認できませんでした',
          body: e instanceof Error ? e.message : '',
          kind: 'error',
        })
      }
      await refresh()
    })()
  }

  const checkRobotConnection = (config: RobotConfig) =>
    createRobotAdapter(config).checkConnection()

  // 回収は受取確認の対象外(荷台回収完了の通知は出さない)
  const pendingReceiptCount = tasks.filter(
    (t) => t.kind !== 'collect' && t.phase === 'completed' && !t.confirmedAt,
  ).length
  const currentArea = findArea(master, state.currentAreaId)

  const value: StoreContextValue = {
    ...state,
    master,
    areas: master.areas,
    addresses: master.addresses,
    racks: master.racks,
    users: master.users,
    masterLoaded,
    tasks,
    currentArea,
    toasts,
    pendingReceiptCount,
    robotAdapterName: adapter.name,
    setCurrentArea: (areaId) => dispatch({ type: 'SET_CURRENT_AREA', areaId }),
    updateRack: (rack) =>
      setMaster((m) => ({ ...m, racks: m.racks.map((r) => (r.id === rack.id ? rack : r)) })),
    setRobotConfig: (config) => dispatch({ type: 'SET_ROBOT_CONFIG', config }),
    setDemoError: (value) => dispatch({ type: 'SET_DEMO_ERROR', value }),
    setDemoOffline: (value) => {
      if (!value) setScreenError(null)
      dispatch({ type: 'SET_DEMO_OFFLINE', value })
    },
    screenError,
    reportScreenLoadFailed: () => setScreenError(SCREEN_LOAD_ERROR),
    dismissScreenError: () => setScreenError(null),
    lastFetchedAt,
    startTransport,
    cancelTask,
    cancelRequest,
    confirmReceipt,
    dismissToast,
    checkRobotConnection,
  }

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore は StoreProvider の内側で使用してください')
  return ctx
}
