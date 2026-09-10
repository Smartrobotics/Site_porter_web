import type { RobotAdapter } from './types'
import { MockRobotAdapter } from './MockRobotAdapter'
import { AtmobiAdapter } from './AtmobiAdapter'

export type RobotAdapterKind = 'mock' | 'atmobi'

export interface RobotConfig {
  kind: RobotAdapterKind
  atmobiUrl: string
}

export function createRobotAdapter(config: RobotConfig): RobotAdapter {
  if (config.kind === 'atmobi') {
    return new AtmobiAdapter(config.atmobiUrl)
  }
  return new MockRobotAdapter()
}

export * from './types'
