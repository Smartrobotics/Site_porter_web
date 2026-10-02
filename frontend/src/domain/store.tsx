import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
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

export interface RobotState {
  id: number
  name: string
  phase: string
  scenarioName: string | null
  stepIndex: number | null
  stepTotal: number | null
  requestId: number | null
  mode: string
  floor: number | null
  stuckReason: string | null
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
  error: '通信できません',
}

export function robotPhaseLabel(phase: string): string {
  return ROBOT_PHASE_LABEL[phase] ?? phase
}

const STORAGE_KEY = 'siteporter.state.v4'
const POLL_MS = 3000

interface PersistState {
  currentAreaId?: number
  viewerUserId?: number
  announcedIds: number[]
}

export const SCREEN_LOAD_ERROR = 'サーバと通信できませんでした。時間をおいて再度お試しください。'

export const INVALID_REQUEST_MESSAGE = '依頼の内容が正しくありません。入力を確認してください。'

export const SERVER_FAULT_MESSAGE = 'サーバーでエラーが発生しました。時間をおいて再度お試しください。'

export const SERVER_UNREACHABLE_MESSAGE = 'サーバーに接続できませんでした。時間をおいて再度お試しください。'

const initialState: PersistState = {
  currentAreaId: undefined,
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
  | { type: 'SET_VIEWER_USER'; userId?: number }
  | { type: 'MARK_ANNOUNCED'; ids: number[] }

function reducer(state: PersistState, action: Action): PersistState {
  switch (action.type) {
    case 'SET_CURRENT_AREA':
      return { ...state, currentAreaId: action.areaId }
    case 'SET_VIEWER_USER':
      return { ...state, viewerUserId: action.userId }
    case 'MARK_ANNOUNCED': {
      const merged = Array.from(new Set([...state.announcedIds, ...action.ids]))
      return { ...state, announcedIds: merged.slice(-200) }
    }
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
  master: Master
  areas: Area[]
  addresses: Address[]
  racks: Rack[]
  users: User[]
  masterLoaded: boolean
  tasks: TransportTask[]
  robot: RobotState | null
  clockOffsetMs: number
  currentArea: Area | undefined
  toasts: Toast[]
  pendingReceiptCount: number
  setCurrentArea: (areaId?: number) => void
  setViewerUser: (userId?: number) => void
  arrival: TransportTask | null
  dismissArrival: () => void
  setRackMarker: (rackId: number, markerId: number) => Promise<void>
  savePlacement: (items: { rackId: number; addressId: number }[]) => Promise<void>
  screenError: string | null
  reportScreenLoadFailed: () => void
  dismissScreenError: () => void
  lastFetchedAt: number
  startTransport: (req: TransportRequest) => Promise<number>
  cancelTask: (id: number) => Promise<void>
  resetRobotHome: () => Promise<void>
  cancelRequest: (id: number, mode: 'delete' | 'reset') => Promise<void>
  confirmReceipt: (taskId: number) => void
  dismissToast: (id: string) => void
}

const StoreContext = createContext<StoreContextValue | null>(null)

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

async function send(path: string, body?: unknown): Promise<RequestRaw> {
  let res: Response
  try {
    res = await fetchWithTimeout(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new Error(SERVER_UNREACHABLE_MESSAGE)
  }
  if (res.status === 502 || res.status === 503 || res.status === 504) {
    throw new Error(SERVER_UNREACHABLE_MESSAGE)
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) {
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
  const [lastFetchedAt, setLastFetchedAt] = useState(Date.now())
  const [screenError, setScreenError] = useState<string | null>(null)

  const pushToast = (t: Omit<Toast, 'id'>) => {
    const toast: Toast = { ...t, id: uid('toast') }
    setToasts((prev) => [...prev, toast])
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== toast.id))
    }, 5000)
  }

  const dismissToast = (id: string) => setToasts((prev) => prev.filter((x) => x.id !== id))

  const refresh = useCallback(async () => {
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
    }
  }, [])

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

  useEffect(() => {
    void refresh()
    const t = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(t)
  }, [refresh])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
    }
  }, [state])

  const tasks = useMemo(
    () =>
      raws.map((r) =>
        toTask(r, r.status === 'queued' && freeAddressesInArea(master, r.to_area_id).length === 0),
      ),
    [raws, master],
  )

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
