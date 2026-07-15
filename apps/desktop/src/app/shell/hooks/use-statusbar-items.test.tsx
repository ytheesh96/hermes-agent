import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { $kanbanStatusBySession, reconcileKanbanSessionSourceForComposer } from '@/store/composer-status'
import { $loopagentsBySession, upsertLoopagent } from '@/store/loopagents'
import { $activeSessionId } from '@/store/session'
import { $subagentsBySession, upsertSubagent } from '@/store/subagents'

import { useStatusbarItems } from './use-statusbar-items'

vi.mock('@/i18n', () => ({
  useI18n: () => ({
    t: {
      fileMenu: {
        copyPath: 'Copy path',
        revealFileManager: 'Reveal in file manager',
        revealInSidebar: 'Reveal in sidebar'
      },
      shell: {
        approvalMode: {
          ariaLabel: (value: string) => `Approval mode ${value}`,
          manual: 'Manual',
          manualDescription: 'Ask for every approval',
          off: 'Off',
          offDescription: 'Skip approvals',
          smart: 'Smart',
          smartDescription: 'Ask when needed',
          title: 'Approval mode'
        },
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
          subagents: (count: number) => `${count} subagent${count === 1 ? '' : 's'}`,
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

describe('useStatusbarItems agent activity', () => {
  beforeEach(() => {
    $activeSessionId.set('session-with-workers')
    $kanbanStatusBySession.set({})
    $loopagentsBySession.set({})
    $subagentsBySession.set({})
  })

  afterEach(() => {
    cleanup()
    $activeSessionId.set(null)
    $kanbanStatusBySession.set({})
    $loopagentsBySession.set({})
    $subagentsBySession.set({})
  })

  it('keeps the Subagent label for ordinary spawned subagents', () => {
    upsertSubagent('session-with-workers', {
      goal: 'Inspect activity',
      status: 'running',
      subagent_id: 'subagent:inspect'
    })

    const { result } = renderHook(() => useStatusbarItems(baseOptions))
    const agents = result.current.leftStatusbarItems.find(item => item.id === 'agents')

    expect(agents?.detail).toBe('1 subagent')
  })

  it('folds durable Kanban worker activity into the Agents statusbar item', () => {
    reconcileKanbanSessionSourceForComposer({
      sourceSessionId: 'session-with-workers',
      source: {
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
      }
    })

    const { result } = renderHook(() => useStatusbarItems(baseOptions))
    const agents = result.current.leftStatusbarItems.find(item => item.id === 'agents')

    expect(agents?.detail).toBe('1 failed · 1 running')
  })

  it('deduplicates live Loopagent activity written under origin and worker session keys', () => {
    upsertLoopagent(
      ['session-with-workers', 'worker-session-3'],
      {
        current_tool: 'terminal',
        run_id: 3,
        run_status: 'running',
        source_session_id: 'session-with-workers',
        task_id: 't_live',
        task_title: 'Live Loop worker',
        worker_session_id: 'worker-session-3'
      },
      'kanban.worker.tool_start'
    )

    const { result } = renderHook(() => useStatusbarItems(baseOptions))
    const agents = result.current.leftStatusbarItems.find(item => item.id === 'agents')

    expect(agents?.detail).toBe('1 running')
  })
})
