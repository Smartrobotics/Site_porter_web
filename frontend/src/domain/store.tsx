import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { AppNotification, Cart, TransportRequest, TransportTask } from './types'
import { INITIAL_CARTS } from './people'
import type { BuildingProfile, SpotDef } from '../building/types'
import { findRoute, floorLabel } from '../building/types'
import { DEFAULT_BUILDING_ID, getBuilding } from '../building/sampleBuildings'
import { createRobotAdapter, type RobotConfig } from '../robot'
import { isActivePhase } from './phase'
import type { RobotStatusUpdate, RobotTransportPhase } from '../robot/types'

const STORAGE_KEY = 'siteporter.state.v2'

interface PersistState {
  buildingId: string
  /** 現在地(場所QRエントリーで確定)。localStorage永続化 */
  currentSpotId?: string
  carts: Cart[]
  tasks: TransportTask[]
  notifications: AppNotification[]
  robotConfig: RobotConfig
  /** デモ用。搬送依頼の送信を必ず失敗させ、エラーモーダルを見せるための設定 */
  demoError: DemoError
  /** デモ用。true の間はポーリングが失敗し続ける(E10 の再現) */
  demoOffline: boolean
}

/**
 * none = 何も起こさない
 * e6 / e8 = モーダルを出して受付を断る
 * e7 = 搬送先に空き場所がない。モーダルは出さず、受け付けて順番待ちにする
 */
export type DemoError = 'none' | 'e6' | 'e8' | 'e7'

/** 画面遷移時にサーバーと通信できなかったときの共通メッセージ */
export const SCREEN_LOAD_ERROR = 'サーバと通信できませんでした。時間をおいて再度お試しください。'

export const DEMO_ERROR_MESSAGE: Record<'e6' | 'e8', string> = {
  e6: 'サーバーに接続できませんでした。時間をおいて再度お試しください。',
  e8: '指定された荷台は使用中です。別の荷台を選んでください。',
}

const initialState: PersistState = {
  buildingId: DEFAULT_BUILDING_ID,
  currentSpotId: undefined,
  carts: INITIAL_CARTS,
  tasks: [],
  notifications: [],
  robotConfig: { kind: 'mock', atmobiUrl: 'http://localhost:5000' },
  demoError: 'none',
  demoOffline: false,
}

function loadState(): PersistState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return initialState
    const parsed = JSON.parse(raw) as Partial<PersistState>
    return { ...initialState, ...parsed }
  } catch {
    return initialState
  }
}

type Action =
  | { type: 'SET_BUILDING'; id: string }
  | { type: 'SET_CURRENT_SPOT'; spotId?: string }
  | { type: 'ADD_CART'; cart: Cart }
  | { type: 'UPDATE_CART'; cart: Cart }
  | { type: 'SET_ROBOT_CONFIG'; config: RobotConfig }
  | { type: 'SET_DEMO_ERROR'; value: DemoError }
  | { type: 'SET_DEMO_OFFLINE'; value: boolean }
  | { type: 'ADD_TASK'; task: TransportTask }
  | { type: 'UPDATE_TASK'; id: string; patch: Partial<TransportTask> }
  | { type: 'ADD_NOTIFICATION'; notification: AppNotification }
  | { type: 'MARK_NOTIF_READ'; id: string }
  | { type: 'MARK_ALL_READ' }

function reducer(state: PersistState, action: Action): PersistState {
  switch (action.type) {
    case 'SET_BUILDING':
      return { ...state, buildingId: action.id }
    case 'SET_CURRENT_SPOT':
      return { ...state, currentSpotId: action.spotId }
    case 'ADD_CART':
      return { ...state, carts: [...state.carts, action.cart] }
    case 'UPDATE_CART':
      return {
        ...state,
        carts: state.carts.map((c) => (c.id === action.cart.id ? action.cart : c)),
      }
    case 'SET_ROBOT_CONFIG':
      return { ...state, robotConfig: action.config }
    case 'SET_DEMO_ERROR':
      return { ...state, demoError: action.value }
    case 'SET_DEMO_OFFLINE':
      return { ...state, demoOffline: action.value }
    case 'ADD_TASK':
      return { ...state, tasks: [action.task, ...state.tasks] }
    case 'UPDATE_TASK':
      return {
        ...state,
        tasks: state.tasks.map((t) => (t.id === action.id ? { ...t, ...action.patch } : t)),
      }
    case 'ADD_NOTIFICATION':
      return { ...state, notifications: [action.notification, ...state.notifications] }
    case 'MARK_NOTIF_READ':
      return {
        ...state,
        notifications: state.notifications.map((n) =>
          n.id === action.id ? { ...n, read: true } : n,
        ),
      }
    case 'MARK_ALL_READ':
      return { ...state, notifications: state.notifications.map((n) => ({ ...n, read: true })) }
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
  building: BuildingProfile
  /** 現在建物内で解決した現在地(未設定/別建物の場合 undefined) */
  currentSpot: SpotDef | undefined
  toasts: Toast[]
  unreadCount: number
  /** 受取確認が済んでいない搬送の件数(通知タブのバッジ) */
  pendingReceiptCount: number
  robotAdapterName: string
  // actions
  setBuildingId: (id: string) => void
  setCurrentSpot: (spotId?: string) => void
  addCart: (cart: Cart) => void
  updateCart: (cart: Cart) => void
  setRobotConfig: (config: RobotConfig) => void
  setDemoError: (value: DemoError) => void
  setDemoOffline: (value: boolean) => void
  /** 画面遷移時の取得に失敗した(共通モーダルを出す) */
  screenError: string | null
  reportScreenLoadFailed: () => void
  dismissScreenError: () => void
  /** 最後にポーリングが成功した時刻。失敗しても更新しない(E10) */
  lastFetchedAt: number
  startTransport: (req: TransportRequest) => Promise<string>
  cancelTask: (id: string) => Promise<void>
  cancelRequest: (id: string, mode: 'delete' | 'reset') => Promise<void>
  markNotificationRead: (id: string) => void
  markAllRead: () => void
  /** 受取人が荷物を受け取ったことを確認する */
  confirmReceipt: (taskId: string) => void
  dismissToast: (id: string) => void
  checkRobotConnection: (config: RobotConfig) => Promise<{ ok: boolean; detail: string }>
}

const StoreContext = createContext<StoreContextValue | null>(null)

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

const PHASE_MESSAGE: Record<RobotTransportPhase, string> = {
  idle: '待機中',
  queued: '順番待ち',
  dispatching: '配車手配中…',
  loading: '積込準備中…',
  transporting: '搬送中…',
  arrived: '受渡場所に到着',
  returning: '空荷台を回収中…',
  completed: '搬送完了',
  error: 'エラーが発生しました',
  cancelled: '取り消しました',
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadState)
  const [toasts, setToasts] = useState<Toast[]>([])
  // 搬送状況のポーリング。成功した時刻だけを持つ。
  // 失敗してもエラーは出さず、この時刻を更新しないでおく(E10)
  const [lastFetchedAt, setLastFetchedAt] = useState(Date.now())
  // 画面遷移時の取得失敗。ポーリング断(E10)と違い、こちらは黙らずに知らせる
  const [screenError, setScreenError] = useState<string | null>(null)
  useEffect(() => {
    const t = setInterval(() => {
      if (!state.demoOffline) setLastFetchedAt(Date.now())
    }, 3000)
    return () => clearInterval(t)
  }, [state.demoOffline])

  // 永続化
  useEffect(() => {
    const toSave: PersistState = {
      buildingId: state.buildingId,
      currentSpotId: state.currentSpotId,
      carts: state.carts,
      tasks: state.tasks,
      notifications: state.notifications,
      robotConfig: state.robotConfig,
      demoError: state.demoError,
      demoOffline: state.demoOffline,
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave))
    } catch {
      /* ignore quota errors */
    }
  }, [state])

  // ロボットアダプタ(設定変更で再生成)
  const adapter = useMemo(
    () => createRobotAdapter(state.robotConfig),
    [state.robotConfig],
  )
  const adapterRef = useRef(adapter)
  adapterRef.current = adapter

  const unsubsRef = useRef<Map<string, () => void>>(new Map())
  /** 二重起動よけ。dispatch は即時に反映されないため */
  const startingRef = useRef<Set<string>>(new Set())

  // アンマウント時に全購読解除
  useEffect(() => {
    const map = unsubsRef.current
    return () => {
      map.forEach((fn) => fn())
      map.clear()
    }
  }, [])

  const building = getBuilding(state.buildingId)

  const pushToast = (t: Omit<Toast, 'id'>) => {
    const toast: Toast = { ...t, id: uid('toast') }
    setToasts((prev) => [...prev, toast])
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== toast.id))
    }, 5000)
  }

  const dismissToast = (id: string) => setToasts((prev) => prev.filter((x) => x.id !== id))

  const handleUpdate = (task: TransportTask, u: RobotStatusUpdate) => {
    dispatch({
      type: 'UPDATE_TASK',
      id: task.id,
      patch: {
        phase: u.phase,
        progress: u.progress,
        rawState: u.rawState,
        statusMessage: u.message,
        ...(u.phase === 'completed' ? { completedAt: Date.now() } : {}),
      },
    })

    if (u.phase === 'completed') {
      const b = getBuilding(task.buildingId)
      const route = `${floorLabel(b, task.fromFloorId)} → ${floorLabel(b, task.toFloorId)}`
      const hasRecipient = !!task.recipient && task.recipient !== '未指定'

      // 荷降ろしを終えて荷台の下から出た時点で、サーバーが空荷台の回収を決める。
      // 回収は搬送の続きではなく、別の依頼・別の走行として動かす。
      // 回収そのものが終わったときは何も作らない(回収完了の通知も不要)
      if (task.kind !== 'collect') {
        const empty = state.carts.find((c) => c.id !== task.cartId) ?? state.carts[0]
        if (empty) {
          void startTransport({
            id: uid('col'),
            kind: 'collect',
            createdBy: 'system',
            parentTaskId: task.id,
            cartId: empty.id,
            // 空荷台は搬送先の階にあり、集積場所へ戻す
            fromFloorId: task.toFloorId,
            fromSpotId: task.toSpotId,
            toFloorId: task.fromFloorId,
            toSpotId: task.fromSpotId,
            itemName: '',
            recipient: '',
            priority: task.priority,
          })
        }
      } else {
        // 回収は通知もトーストも出さない
        const un0 = unsubsRef.current.get(task.id)
        if (un0) {
          un0()
          unsubsRef.current.delete(task.id)
        }
        return
      }

      dispatch({
        type: 'ADD_NOTIFICATION',
        notification: {
          id: uid('ntf'),
          taskId: task.id,
          title: '搬送が完了しました',
          body: hasRecipient
            ? `「${task.itemName}」を ${route} へ搬送し、${task.recipient} 宛にお届けしました。`
            : `「${task.itemName}」を ${route} へ搬送し、お届けしました。`,
          createdAt: Date.now(),
          read: false,
          kind: 'completed',
        },
      })
      // 完了のトーストは出さない。同じ内容が通知一覧に出るため
      const un = unsubsRef.current.get(task.id)
      if (un) {
        un()
        unsubsRef.current.delete(task.id)
      }
    } else if (u.phase === 'error') {
      dispatch({
        type: 'ADD_NOTIFICATION',
        notification: {
          id: uid('ntf'),
          taskId: task.id,
          title: '搬送エラー',
          body: u.message,
          createdAt: Date.now(),
          read: false,
          kind: 'error',
        },
      })
      pushToast({ title: '搬送エラー', body: u.message, kind: 'error' })
      const un = unsubsRef.current.get(task.id)
      if (un) {
        un()
        unsubsRef.current.delete(task.id)
      }
    }
  }

  const startTransport = async (req: TransportRequest): Promise<string> => {
    // E6 / E8 は受け付けない。モーダルを出して依頼も作らない
    if ((state.demoError === 'e6' || state.demoError === 'e8') && req.kind !== 'collect') {
      throw new Error(DEMO_ERROR_MESSAGE[state.demoError])
    }
    const currentAdapter = adapterRef.current
    // E9: ロボットが実行中なら順番待ちにする
    const robotBusy = state.tasks.some((t) => isActivePhase(t.phase))
    // E7: 搬送先に空き場所がない(デモでは設定で再現する)
    const noSpace = state.demoError === 'e7' && req.kind !== 'collect'
    const wait = robotBusy || noSpace

    const task: TransportTask = {
      ...req,
      buildingId: building.id,
      createdAt: Date.now(),
      phase: wait ? 'queued' : 'dispatching',
      progress: 0,
      statusMessage: noSpace
        ? '搬送先に空き場所がないため、空くまでお待ちください'
        : wait
          ? '順番待ち — ロボットが別の搬送を実行中です'
          : PHASE_MESSAGE.dispatching,
      robotAdapterName: currentAdapter.name,
    }
    dispatch({ type: 'ADD_TASK', task })

    // 受付だけして走らせない。順番が来たら runQueued() が拾う
    if (wait) return task.id

    await runOnRobot(task)
    return task.id
  }

  /** 依頼を実際にロボットへ渡す。新規受付でも順番待ちからでも同じ道を通る */
  const runOnRobot = async (task: TransportTask) => {
    if (startingRef.current.has(task.id)) return
    startingRef.current.add(task.id)
    const currentAdapter = adapterRef.current
    const route = findRoute(building, task.fromFloorId, task.toFloorId)
    if (!route) {
      dispatch({
        type: 'UPDATE_TASK',
        id: task.id,
        patch: { phase: 'error', statusMessage: '該当する経路マッピングが未定義です' },
      })
      return
    }
    try {
      const robotTaskId = await currentAdapter.startTransport(task, route)
      dispatch({ type: 'UPDATE_TASK', id: task.id, patch: { robotTaskId } })
      const unsub = currentAdapter.subscribe(robotTaskId, (u) => handleUpdate(task, u))
      unsubsRef.current.set(task.id, unsub)
    } catch (e) {
      const msg = e instanceof Error ? e.message : '搬送開始に失敗しました'
      dispatch({ type: 'UPDATE_TASK', id: task.id, patch: { phase: 'error', statusMessage: msg } })
      pushToast({ title: '搬送開始エラー', body: msg, kind: 'error' })
    }
  }

  /** 順番待ちの先頭を1件走らせる。ロボットが空いたときに呼ぶ */
  const runQueued = () => {
    if (state.demoError === 'e7') return // 空き場所ができるまで待つ
    if (state.tasks.some((t) => isActivePhase(t.phase))) return
    const next = state.tasks
      .filter((t) => t.phase === 'queued')
      .sort((a, b) => a.createdAt - b.createdAt)[0]
    if (!next) return
    dispatch({
      type: 'UPDATE_TASK',
      id: next.id,
      patch: { phase: 'dispatching', statusMessage: PHASE_MESSAGE.dispatching },
    })
    void runOnRobot({ ...next, phase: 'dispatching' })
  }

  // ロボットが空いたら順番待ちの先頭を走らせる
  useEffect(() => {
    runQueued()
  })

  /**
   * 管理者による依頼の取消。
   *   delete = 完全に削除(あらためて搬送依頼が必要)
   *   reset  = 搬送開始前(ロボットアサイン前)の状態に戻す(依頼はそのまま残る)
   * どちらでもロボットへの購読は切り、走行中なら止める。
   * エレベータ側のキャンセルは別システムなので、この操作では行えない。
   */
  const cancelRequest = async (id: string, mode: 'delete' | 'reset') => {
    const task = state.tasks.find((t) => t.id === id)
    const un = unsubsRef.current.get(id)
    if (un) {
      un()
      unsubsRef.current.delete(id)
    }
    startingRef.current.delete(id)
    if (task?.robotTaskId) {
      try {
        await adapterRef.current.cancel(task.robotTaskId)
      } catch {
        /* ignore */
      }
    }
    dispatch({
      type: 'UPDATE_TASK',
      id,
      patch:
        mode === 'delete'
          ? { phase: 'cancelled', isDeleted: true, statusMessage: '取り消して削除しました' }
          : {
              phase: 'queued',
              progress: 0,
              robotTaskId: undefined,
              statusMessage: '搬送開始前の状態に戻しました',
            },
    })
  }

  const cancelTask = async (id: string) => {
    const task = state.tasks.find((t) => t.id === id)
    const un = unsubsRef.current.get(id)
    if (un) {
      un()
      unsubsRef.current.delete(id)
    }
    if (task?.robotTaskId) {
      try {
        await adapterRef.current.cancel(task.robotTaskId)
      } catch {
        /* ignore */
      }
    }
    dispatch({
      type: 'UPDATE_TASK',
      id,
      patch: { phase: 'error', statusMessage: '搬送を中止しました' },
    })
  }

  const checkRobotConnection = (config: RobotConfig) =>
    createRobotAdapter(config).checkConnection()

  const unreadCount = state.notifications.filter((n) => !n.read).length
  // 回収は受取確認の対象外(荷台回収完了の通知は出さない)
  const pendingReceiptCount = state.tasks.filter(
    (t) => !t.isDeleted && t.kind !== 'collect' && t.phase === 'completed' && !t.confirmedAt,
  ).length
  const currentSpot = building.spots.find((s) => s.id === state.currentSpotId)

  const value: StoreContextValue = {
    ...state,
    building,
    currentSpot,
    toasts,
    unreadCount,
    pendingReceiptCount,
    robotAdapterName: adapter.name,
    setBuildingId: (id) => dispatch({ type: 'SET_BUILDING', id }),
    setCurrentSpot: (spotId) => dispatch({ type: 'SET_CURRENT_SPOT', spotId }),
    addCart: (cart) => dispatch({ type: 'ADD_CART', cart }),
    updateCart: (cart) => dispatch({ type: 'UPDATE_CART', cart }),
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
    markNotificationRead: (id) => dispatch({ type: 'MARK_NOTIF_READ', id }),
    markAllRead: () => dispatch({ type: 'MARK_ALL_READ' }),
    confirmReceipt: (taskId) =>
      dispatch({ type: 'UPDATE_TASK', id: taskId, patch: { confirmedAt: Date.now() } }),
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
