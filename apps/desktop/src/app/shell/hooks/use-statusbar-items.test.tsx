import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getLoopSessionSource } from '@/hermes'
import { $activeGatewayProfile } from '@/store/profile'
import { $activeSessionId } from '@/store/session'

import { useStatusbarItems } from './use-statusbar-items'

vi.mock('@/hermes', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getLoopSessionSource: vi.fn()
}))

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: {
      shell: {
        statusbar: {
          agents: 'Agents',
          backendLabel: (value: string) => `Backend ${value}`,
          backendVersion: (value: string) => `Backend ${value}`,
          clientLabel: (value: string) => `Client ${value}`,
          closeAgents: 'Close agents',
          closeCommandCenter: 'Close command center',
          commit: (value: string) => `Commit ${value}`,
          commitsBehind: (value: number) => `${value} commits behind`,
          contextUsage: 'Context usage',
          cron: 'Cron',
          currentTurnElapsed: 'Current turn elapsed',
          desktopVersion: (value: string) => `Desktop ${value}`,
          failed: (count: number) => `${count} failed`,
          gateway: 'Gateway',
          gatewayChecking: 'Checking',
          gatewayConnecting: 'Connecting',
          gatewayNeedsSetup: 'Needs setup',
          gatewayOffline: 'Offline',
          gatewayReady: 'Ready',
          gatewayTitle: 'Gateway status',
          hideTerminal: 'Hide terminal',
          modelNone: 'none',
          modelTitle: (provider: string, model: string) => `${provider} ${model}`,
          noModel: 'no model',
          openAgents: 'Open agents',
          openCommandCenter: 'Open command center',
          openCron: 'Open cron',
          openModelPicker: 'Open model picker',
          providerModelTitle: (provider: string, model: string) => `${provider} ${model}`,
          restart: 'Restart',
          running: (count: number) => `${count} running`,
          runtimeSessionElapsed: 'Runtime session elapsed',
          session: 'Session',
          showTerminal: 'Show terminal',
          subagents: (count: number) => `${count} subagents`,
          switchModel: 'Switch model',
          turnRunning: 'Turn running',
          unknown: 'unknown',
          update: 'Update',
          updateInProgress: 'Update in progress',
          yoloOff: 'YOLO off',
          yoloOn: 'YOLO on'
        }
      }
    }
  })
}))

const baseOptions = {
  agentsOpen: false,
  chatOpen: true,
  commandCenterOpen: false,
  extraLeftItems: [],
  extraRightItems: [],
  freshDraftReady: false,
  gatewayLogLines: [],
  gatewayState: 'open' as const,
  inferenceStatus: { checksDisagree: false, ready: true, reason: null, source: 'runtime_check' as const },
  openAgents: vi.fn(),
  openCommandCenterSection: vi.fn(),
  requestGateway: vi.fn(),
  statusSnapshot: null,
  toggleCommandCenter: vi.fn()
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('useStatusbarItems Kanban workers', () => {
  beforeEach(() => {
    $activeSessionId.set('session-with-workers')
    $activeGatewayProfile.set('peacock')
    vi.mocked(getLoopSessionSource).mockResolvedValue({
      now: 1_000,
      workers: [
        {
          last_heartbeat_at: 990,
          run_id: 1,
          started_at: 900,
          status: 'running',
          task_id: 't_running',
          task_title: 'Running task'
        },
        {
          ended_at: 950,
          error: 'needs review',
          outcome: 'failed',
          run_id: 2,
          started_at: 800,
          status: 'completed',
          task_id: 't_failed',
          task_title: 'Failed task'
        }
      ]
    })
  })

  afterEach(() => {
    cleanup()
    vi.mocked(getLoopSessionSource).mockReset()
    $activeSessionId.set(null)
    $activeGatewayProfile.set('default')
  })

  it('folds durable Kanban worker activity into the Agents statusbar item', async () => {
    const { result } = renderHook(() => useStatusbarItems(baseOptions), { wrapper })

    await waitFor(() => {
      const agents = result.current.leftStatusbarItems.find(item => item.id === 'agents')

      expect(agents?.detail).toBe('1 Loop worker need attention · 1 Loop worker running')
    })

    expect(getLoopSessionSource).toHaveBeenCalledWith('session-with-workers', 'peacock')
  })
})
