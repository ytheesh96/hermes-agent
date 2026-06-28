import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PREVIEW_PANE_ID } from '@/store/layout'
import { $paneStates } from '@/store/panes'
import { openSessionInNewWindow } from '@/store/windows'

import { useLoopPanelController } from './use-loop-panel-controller'

const hermesMocks = vi.hoisted(() => ({
  addLoopTaskComment: vi.fn(),
  decomposeLoopTask: vi.fn(),
  getLoopSessionSource: vi.fn(),
  getLoopTaskDetail: vi.fn(),
  reviewLoopHandoffForTask: vi.fn(),
  setApiRequestProfile: vi.fn(),
  updateLoopTaskStatus: vi.fn()
}))

vi.mock('@/hermes', () => hermesMocks)

vi.mock('@/store/windows', () => ({
  openSessionInNewWindow: vi.fn()
}))

function demoLoopSource() {
  return {
    board: 'default',
    latest_event_id: 9,
    root_task_id: 'LIVE DISPOSABLE DEMO',
    tasks: [
      {
        assignee: 'orchestrator',
        children: ['Loop draft'],
        id: 'LIVE DISPOSABLE DEMO',
        status: 'scheduled',
        title: 'LIVE DISPOSABLE DEMO DATA'
      },
      {
        assignee: 'orchestrator',
        id: 'Loop draft',
        parents: ['LIVE DISPOSABLE DEMO'],
        status: 'scheduled',
        title: 'Loop draft'
      }
    ]
  }
}

function renderControllerHarness({ gatewayOpen = false }: { gatewayOpen?: boolean } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } }
  })

  function Harness() {
    const controller = useLoopPanelController({
      activeSessionId: 'session-1',
      gatewayOpen,
      loopSourceSessionId: 'session-1',
      onAddContextRef: vi.fn()
    })

    return (
      <>
        <button onClick={() => controller.onSelectTaskId('t_root')} type="button">
          Open Loop row
        </button>
        <button
          onClick={() =>
            queryClient.setQueriesData({ queryKey: ['loop-session-source'] }, source =>
              source && typeof source === 'object'
                ? { ...source, latest_event_id: Number((source as { latest_event_id?: number }).latest_event_id || 0) + 1 }
                : source
            )
          }
          type="button"
        >
          Refresh Loop source
        </button>
        <button
          onClick={() =>
            controller.onTaskAction('worker-session', {
              active: true,
              assignee: 'reviewer-qa',
              childCount: 0,
              children: [],
              commentCount: 0,
              depth: 0,
              frontier: true,
              latestRun: { id: 7, profile: 'reviewer-qa', status: 'running', worker_session_id: 'worker-session-7' },
              parentCount: 0,
              parents: [],
              status: 'running',
              taskId: 't_worker',
              title: 'Worker task'
            })
          }
          type="button"
        >
          Open worker session
        </button>
        <output data-testid="loop-open">{String(controller.open)}</output>
        <output data-testid="loop-selected">{controller.selectedTaskId || ''}</output>
      </>
    )
  }

  return render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>
  )
}

describe('useLoopPanelController', () => {
  beforeEach(() => {
    $paneStates.set({ [PREVIEW_PANE_ID]: { open: false } })
    hermesMocks.getLoopSessionSource.mockResolvedValue(demoLoopSource())
    hermesMocks.getLoopTaskDetail.mockResolvedValue({ task: null })
    window.history.replaceState(null, '', '/')
  })

  afterEach(() => {
    cleanup()
    $paneStates.set({})
    vi.mocked(openSessionInNewWindow).mockReset()
    Object.values(hermesMocks).forEach(mock => mock.mockReset())
    window.history.replaceState(null, '', '/')
  })

  it('reopens the shared work rail pane when a Loop row is selected from a persisted-closed state', () => {
    renderControllerHarness()

    expect($paneStates.get()[PREVIEW_PANE_ID]?.open).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: /open loop row/i }))

    expect(screen.getByTestId('loop-open').textContent).toBe('true')
    expect(screen.getByTestId('loop-selected').textContent).toBe('t_root')
    expect($paneStates.get()[PREVIEW_PANE_ID]?.open).toBe(true)
  })

  it('auto-opens the Loop rail from a public demo launch query once session-source rows hydrate', async () => {
    window.history.replaceState(null, '', '/?loop=1&loopTask=Loop%20draft')

    renderControllerHarness({ gatewayOpen: true })

    await waitFor(() => expect(screen.getByTestId('loop-open').textContent).toBe('true'))
    expect(screen.getByTestId('loop-selected').textContent).toBe('Loop draft')
    expect($paneStates.get()[PREVIEW_PANE_ID]?.open).toBe(true)
  })

  it('does not reselect the launch-query Loop row after the user changes selection', async () => {
    window.history.replaceState(null, '', '/?loop=1&loopTask=Loop%20draft')

    renderControllerHarness({ gatewayOpen: true })

    await waitFor(() => expect(screen.getByTestId('loop-selected').textContent).toBe('Loop draft'))
    fireEvent.click(screen.getByRole('button', { name: /open loop row/i }))
    expect(screen.getByTestId('loop-selected').textContent).toBe('t_root')

    fireEvent.click(screen.getByRole('button', { name: /refresh loop source/i }))

    await waitFor(() => expect(screen.getByTestId('loop-selected').textContent).toBe('t_root'))
  })

  it('opens Loop worker sessions with the worker profile so cross-profile watch windows hydrate', () => {
    renderControllerHarness()

    fireEvent.click(screen.getByRole('button', { name: /open worker session/i }))

    expect(openSessionInNewWindow).toHaveBeenCalledWith('worker-session-7', {
      profile: 'reviewer-qa',
      watch: true
    })
  })
})
