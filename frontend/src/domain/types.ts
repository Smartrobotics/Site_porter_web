import type { RobotTransportPhase } from './phase'

export type Priority = 'urgent' | 'normal' | 'low'


export interface AppNotification {
  id: string
  taskId: number
  title: string
  body: string
  createdAt: number
  read: boolean
  kind: 'completed' | 'info' | 'error'
}

export interface TransportRequest {
  id: number
  kind?: 'delivery' | 'collect'
  createdBy?: 'user' | 'system'
  parentTaskId?: number
  rackId: number
  trackingNo?: string
  markerId?: number
  fromAreaId: number
  toAreaId: number
  fromAddressId?: number
  toAddressId?: number
  itemName: string
  recipient: string
  priority: Priority
}

export interface TransportTask extends TransportRequest {
  createdAt: number
  phase: RobotTransportPhase
  progress: number
  stepTotal?: number
  fragmentKind?: string
  fragmentSeq?: number
  robotFloor?: number
  action?: string
  actionIndex?: number
  actionSince?: number
  pauseReason?: string
  robotOffline?: boolean
  rawState?: number
  statusMessage: string
  robotTaskId?: string
  robotAdapterName: string
  completedAt?: number
  confirmedAt?: number
  isDeleted?: boolean
}

export const PRIORITY_LABEL: Record<Priority, string> = {
  urgent: '高',
  normal: '中',
  low: '低',
}

export const PRIORITY_TO_DB: Record<Priority, number> = { urgent: 1, normal: 2, low: 3 }
export const PRIORITY_FROM_DB: Record<number, Priority> = {
  1: 'urgent',
  2: 'normal',
  3: 'low',
}
