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
import { fetchWithTimeout } from '../lib/http'

/** GET /api/robot。ロボットを動かすのはサーバー。画面は読むだけ */
export interface RobotState {
  id: number
  name: string
  phase: string
  scenarioName: string | null
  stepIndex: number | null
  stepTotal: number | null
  /** いま走っている依頼 */
  requestId: number | null
  /** mock = ロボット無しで時間だけ進む。docker-compose.yml の ROBOT_MODE で決まる */
  mode: string
  /** ロボットがいる階(エレベーター断片の完了で更新) */
  floor: number | null
  /** 人の手が要る理由。null なら不要。入っている間サーバーは新しい走行を始めない */
  stuckReason: string | null
  /** 走行中の一時停止の理由。"emergency stop" = 非常停止中。通常は null */
  pauseReason: string | null
}

interface RobotRaw {
  id: number
  name: string
  phase: string
  scenario_name: string | null
  step_index: number | null
  step_total: number | null
  request_id: number | null
  mode: string
  floor: number | null
  stuck_reason: string | null
  pause_reason: string | null
  server_now: string | null
}

const ROBOT_PHASE_LABEL: Record<string, string> = {
  idle: '待機中',
  delivery: '搬送中',
  return: '空荷台を回収中',
  homing: '戻り中',
  error: 'エラー',
}

export function robotPhaseLabel(phase: string): string {
  return ROBOT_PHASE_LABEL[phase] ?? phase
}

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
  /** デモ用。搬送依頼の送信を必ず失敗させ、エラーモーダルを見せるための設定 */
  demoError: DemoError
  /** デモ用。true の間はポーリングが失敗し続ける(E10 の再現) */
  demoOffline: boolean
  /**
   * この端末を使っている受取人の user.id。個人リンク(?user_id=N)で開いたときに入る。
   * 到着の知らせをこの人宛だけに絞る。無ければ全員分(配送員の端末)
   */
  viewerUserId?: number
  /** 到着の知らせをもう見せた依頼の id。同じ依頼で二度出さない */
  announcedIds: number[]
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

/** 依頼の内容をサーバーが受け付けなかった(422)。画面の検証をすり抜けた場合だけ */
export const INVALID_REQUEST_MESSAGE = '依頼の内容が正しくありません。入力を確認してください。'
/** サーバー側の障害(500 など)。届いてはいるが処理できなかった */
export const SERVER_FAULT_MESSAGE = 'サーバーでエラーが発生しました。時間をおいて再度お試しください。'

export const DEMO_ERROR_MESSAGE: Record<'e6' | 'e8', string> = {
  e6: 'サーバーに接続できませんでした。時間をおいて再度お試しください。',
  e8: '指定された荷台は使用中です。別の荷台を選んでください。',
}

const initialState: PersistState = {
  currentAreaId: undefined,
  demoError: 'none',
  demoOffline: false,
  viewerUserId: undefined,
  announcedIds: [],
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
  | { type: 'SET_DEMO_ERROR'; value: DemoError }
  | { type: 'SET_DEMO_OFFLINE'; value: boolean }
  | { type: 'SET_VIEWER_USER'; userId?: number }
  | { type: 'MARK_ANNOUNCED'; ids: number[] }

function reducer(state: PersistState, action: Action): PersistState {
  switch (action.type) {
    case 'SET_CURRENT_AREA':
      return { ...state, currentAreaId: action.areaId }
    case 'SET_VIEWER_USER':
      return { ...state, viewerUserId: action.userId }
    case 'MARK_ANNOUNCED': {
      // 増え続けないよう直近 200 件だけ残す
      const merged = Array.from(new Set([...state.announcedIds, ...action.ids]))
      return { ...state, announcedIds: merged.slice(-200) }
    }
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
  /** ロボットの現在の様子。取得できていなければ null */
  robot: RobotState | null
  /**
   * 端末の時計 − サーバーの時計(ms)。サーバーから来る時刻(ロボットの stamp など)を
   * 端末の時計に直すときに足す。ロボット本体には NTP が無く何分もずれることがある
   */
  clockOffsetMs: number
  /** 現在地のエリア(未設定/未登録なら undefined。E1-2 / E1-3) */
  currentArea: Area | undefined
  toasts: Toast[]
  /** 受取確認が済んでいない搬送の件数(通知タブのバッジ) */
  pendingReceiptCount: number
  // actions
  setCurrentArea: (areaId?: number) => void
  /** 個人リンクで開いた受取人を覚える */
  setViewerUser: (userId?: number) => void
  /** 届いたばかりで、まだこの端末で知らせていない荷物。モーダルに出す */
  arrival: TransportTask | null
  dismissArrival: () => void
  /** 荷台のマーカーIDを付け替える */
  setRackMarker: (rackId: number, markerId: number) => Promise<void>
  /** 荷台配置をまとめて反映する。1台ずつだと入れ替えが途中で衝突する */
  savePlacement: (items: { rackId: number; addressId: number }[]) => Promise<void>
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
  /** 人がロボットを HOME に置き直したと申告する。stuck を解除し at_home を立てる */
  resetRobotHome: () => Promise<void>
  cancelRequest: (id: number, mode: 'delete' | 'reset') => Promise<void>
  /** 受取人が荷物を受け取ったことを確認する */
  confirmReceipt: (taskId: number) => void
  dismissToast: (id: string) => void
}

const StoreContext = createContext<StoreContextValue | null>(null)

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

/**
 * 失敗したらモーダルに出す文面を投げる。
 *   サーバーに届かない(時間切れ・接続失敗・proxy の 502/503/504) … E6 の文面
 *   サーバーが断った(400 系など、detail 付き)                      … その文面(E8 など)
 * 「/api/request: 8000ms 以内に応答がありません」のような内部の文言は人に見せない
 */
async function send(path: string, body?: unknown): Promise<RequestRaw> {
  let res: Response
  try {
    res = await fetchWithTimeout(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new Error(DEMO_ERROR_MESSAGE.e6)
  }
  if (res.status === 502 || res.status === 503 || res.status === 504) {
    throw new Error(DEMO_ERROR_MESSAGE.e6)
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    // detail が文字列 … サーバーが理由を書いた(E8 など)。そのまま見せる
    // detail が配列   … 入力検証(422)。項目ごとの英語の羅列なので人向けに言い換える
    // それ以外        … 500 など。サーバーの障害
    if (data && typeof data.detail === 'string') throw new Error(data.detail)
    if (res.status === 422) throw new Error(INVALID_REQUEST_MESSAGE)
    throw new Error(SERVER_FAULT_MESSAGE)
  }
  return data as RequestRaw
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadState)
  const [master, setMaster] = useState<Master>(EMPTY_MASTER)
  const [masterLoaded, setMasterLoaded] = useState(false)
  const [clockOffsetMs, setClockOffsetMs] = useState(0)
  const [raws, setRaws] = useState<RequestRaw[]>([])
  const [robot, setRobot] = useState<RobotState | null>(null)
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

  /**
   * 依頼と荷台を取り直す。成功したときだけ時刻を進める。
   *
   * 荷台も毎回取る。走行ごとに置き場所が変わるので、開いたときの1回では
   * すぐ古くなる。古い位置で「この荷台は別のエリアにあります」と止めてしまう。
   * エリア・番地・受取人は動かないので、こちらは起動時の1回だけ。
   */
  const refresh = useCallback(async () => {
    if (offlineRef.current) return
    try {
      const [reqRes, rackRes, robotRes] = await Promise.all([
        fetchWithTimeout('/api/request'),
        fetchWithTimeout('/api/rack'),
        fetchWithTimeout('/api/robot'),
      ])
      if (!reqRes.ok || !rackRes.ok || !robotRes.ok) throw new Error('fetch failed')
      const [requests, racks, rb] = await Promise.all([
        reqRes.json(),
        rackRes.json(),
        robotRes.json() as Promise<RobotRaw>,
      ])
      setRaws(requests)
      setMaster((m) => ({ ...m, racks: racks.map(toRack) }))
      if (rb.server_now) {
        const serverNow = Date.parse(rb.server_now)
        if (!Number.isNaN(serverNow)) setClockOffsetMs(Date.now() - serverNow)
      }
      setRobot({
        id: rb.id,
        name: rb.name,
        phase: rb.phase,
        scenarioName: rb.scenario_name,
        stepIndex: rb.step_index,
        stepTotal: rb.step_total,
        requestId: rb.request_id,
        mode: rb.mode,
        floor: rb.floor ?? null,
        stuckReason: rb.stuck_reason ?? null,
        pauseReason: rb.pause_reason ?? null,
      })
      setLastFetchedAt(Date.now())
    } catch {
      // E10: ポーリング断はエラーを出さない。取得時刻が止まることで人に伝わる
    }
  }, [])

  // マスタの取得。起動時に一度だけ
  useEffect(() => {
    let cancelled = false
    const get = async (path: string) => {
      const res = await fetchWithTimeout(path)
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

  const tasks = useMemo(
    () =>
      raws.map((r) =>
        toTask(r, r.status === 'queued' && freeAddressesInArea(master, r.to_area_id).length === 0),
      ),
    [raws, master],
  )

  // 到着の知らせ。ポーリングで「届いた・未確認」になった依頼のうち、
  // この端末でまだ知らせていないものを1件モーダルに出す(通知タブへ行かなくても気付ける)。
  // 受取人の端末(viewerUserId あり)には自分宛だけ、配送員の端末には全部
  const [arrival, setArrival] = useState<TransportTask | null>(null)
  useEffect(() => {
    if (arrival) return
    const viewer = state.viewerUserId !== undefined ? master.users.find((u) => u.id === state.viewerUserId) : undefined
    const fresh = tasks
      .filter((t) => !t.isDeleted && t.kind !== 'collect' && t.phase === 'completed' && !t.confirmedAt)
      .filter((t) => !state.announcedIds.includes(t.id))
      .filter((t) => !viewer || t.recipient === viewer.name)
      .sort((a, b) => (b.completedAt ?? b.createdAt) - (a.completedAt ?? a.createdAt))
    if (fresh.length > 0) setArrival(fresh[0])
  }, [tasks, master.users, state.viewerUserId, state.announcedIds, arrival])
  const dismissArrival = () => {
    if (arrival) dispatch({ type: 'MARK_ANNOUNCED', ids: [arrival.id] })
    setArrival(null)
  }

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

  const resetRobotHome = async () => {
    try {
      const res = await fetchWithTimeout('/api/robot/reset_home', { method: 'POST' })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { detail?: string }
        throw new Error(body.detail ?? `HTTP ${res.status}`)
      }
      pushToast({ title: 'ロボットを HOME にしました', body: '', kind: 'info' })
    } catch (e) {
      pushToast({
        title: 'HOME にできませんでした',
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

  // 回収は受取確認の対象外(荷台回収完了の通知は出さない)。
  // 個人リンクで開いた端末は、通知画面と同じくその人宛だけを数える
  const viewerName =
    state.viewerUserId !== undefined ? master.users.find((u) => u.id === state.viewerUserId)?.name : undefined
  const pendingReceiptCount = tasks.filter(
    (t) =>
      t.kind !== 'collect' &&
      t.phase === 'completed' &&
      !t.confirmedAt &&
      (!viewerName || t.recipient === viewerName),
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
    clockOffsetMs,
    tasks,
    robot,
    currentArea,
    toasts,
    pendingReceiptCount,
    setCurrentArea: (areaId) => dispatch({ type: 'SET_CURRENT_AREA', areaId }),
    setViewerUser: (userId) => dispatch({ type: 'SET_VIEWER_USER', userId }),
    arrival,
    dismissArrival,
    setRackMarker: async (rackId, markerId) => {
      const res = await fetchWithTimeout(`/api/rack/${rackId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marker_id: markerId }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.detail ?? `PATCH /api/rack -> ${res.status}`)
      await refresh()
    },
    savePlacement: async (items) => {
      const res = await fetchWithTimeout('/api/rack/placement', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: items.map((i) => ({ rack_id: i.rackId, street_address_id: i.addressId })),
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.detail ?? `PUT placement -> ${res.status}`)
      await refresh()
    },
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
    resetRobotHome,
    cancelRequest,
    confirmReceipt,
    dismissToast,
  }

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore は StoreProvider の内側で使用してください')
  return ctx
}
