import { QueryClient } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { $loopagentsBySession } from '@/store/loopagents'
import type { RpcEvent } from '@/types/hermes'

import type { ClientSessionState } from '../../types'
import { useMessageStream } from './use-message-stream'

describe('useMessageStream loopagent events', () => {
  beforeEach(() => {
    $loopagentsBySession.set({})
  })

  it('routes loopagent gateway events into the event-fed Loop activity store', () => {
    const queryClient = new QueryClient()
    const activeSessionIdRef = { current: 'runtime-tip' }
    const sessionStateByRuntimeIdRef = { current: new Map<string, ClientSessionState>() }

    const { result } = renderHook(() =>
      useMessageStream({
        activeSessionIdRef,
        hydrateFromStoredSession: vi.fn(async () => undefined),
        queryClient,
        refreshHermesConfig: vi.fn(async () => undefined),
        refreshSessions: vi.fn(async () => undefined),
        sessionStateByRuntimeIdRef,
        updateSessionState: vi.fn()
      })
    )

    act(() => {
      result.current.handleGatewayEvent({
        payload: {
          current_session_id: 'runtime-tip',
          logical_session_id: 'logical-root',
          source_session_id: 'source-root',
          task_id: 't_loop',
          task_title: 'Wire Loop activity',
          run_id: 7,
          event: 'loopagent.worker.upsert',
          run_status: 'running',
          current_tool: 'terminal'
        },
        type: 'loopagent.worker.upsert'
      } as RpcEvent)
    })

    expect($loopagentsBySession.get()['runtime-tip']?.[0]).toMatchObject({
      currentTool: 'terminal',
      id: 'loopagent:worker:t_loop:7',
      kind: 'worker',
      status: 'running',
      taskId: 't_loop',
      title: 'Wire Loop activity'
    })
    expect($loopagentsBySession.get()['logical-root']?.[0]?.id).toBe('loopagent:worker:t_loop:7')
    expect($loopagentsBySession.get()['source-root']?.[0]?.id).toBe('loopagent:worker:t_loop:7')
  })
})
