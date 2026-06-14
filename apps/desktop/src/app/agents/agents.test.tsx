import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getLoopSessionSource } from '@/hermes'
import { $activeGatewayProfile } from '@/store/profile'
import { $activeSessionId } from '@/store/session'
import { clearSessionSubagents } from '@/store/subagents'
import { openSessionInNewWindow } from '@/store/windows'

import { AgentsView } from '.'

const loopSource = {
  now: 1_000,
  session_id: 'loop-session',
  workers: [
    {
      last_heartbeat_at: 990,
      profile: 'peacock',
      run_id: 42,
      started_at: 900,
      status: 'running',
      summary: 'building the overlay',
      task_id: 't_worker',
      task_title: 'Implement Loop workers',
      worker_session_id: 'worker-session-42'
    },
    {
      error: 'missing worker_session_id',
      profile: 'reviewer-qa',
      run_id: 43,
      ended_at: 880,
      started_at: 700,
      status: 'completed',
      outcome: 'failed',
      task_id: 't_no_session',
      task_title: 'Review without session'
    }
  ]
}

vi.mock('@/hermes', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getLoopSessionSource: vi.fn()
}))

vi.mock('@/store/windows', () => ({
  openSessionInNewWindow: vi.fn()
}))

vi.mock('@/lib/use-enter-animation', () => ({
  useEnterAnimation: () => undefined
}))

beforeEach(() => {
  vi.mocked(getLoopSessionSource).mockResolvedValue(loopSource)
})

afterEach(() => {
  cleanup()
  vi.mocked(openSessionInNewWindow).mockClear()
  vi.mocked(getLoopSessionSource).mockReset()
  $activeSessionId.set(null)
  $activeGatewayProfile.set('default')
  clearSessionSubagents('loop-session')
})

function renderAgents() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  $activeSessionId.set('loop-session')
  $activeGatewayProfile.set('peacock')

  return render(
    <QueryClientProvider client={client}>
      <AgentsView onClose={() => undefined} />
    </QueryClientProvider>
  )
}

describe('AgentsView Kanban agents', () => {
  it('renders Kanban worker runs and opens actual worker sessions read-only', async () => {
    renderAgents()

    expect(await screen.findByText('Kanban agents')).toBeTruthy()
    expect(screen.getByText('Implement Loop workers')).toBeTruthy()
    expect(screen.getByText('building the overlay')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Open worker session for t_worker' }))

    await waitFor(() => expect(openSessionInNewWindow).toHaveBeenCalledWith('worker-session-42', { watch: true }))
  })

  it('shows read-only fallback details for workers without a session id', async () => {
    renderAgents()

    const inspect = await screen.findByRole('button', { name: 'Inspect worker run #43 for t_no_session' })

    expect(screen.getByText('No worker session recorded for this run.')).toBeTruthy()
    expect(screen.getByText(/finished 2m ago/)).toBeTruthy()
    fireEvent.click(inspect)
    fireEvent.click(inspect)
    expect(screen.getByText('No worker session recorded for this run.')).toBeTruthy()
    expect(openSessionInNewWindow).not.toHaveBeenCalled()
  })
})
