import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'

import { I18nProvider } from '@/i18n'
import { $kanbanStatusBySession, reconcileKanbanSessionSourceForComposer } from '@/store/composer-status'
import { $loopagentsBySession } from '@/store/loopagents'
import { $previewStatusBySession } from '@/store/preview-status'
import { $threadScrolledUp } from '@/store/thread-scroll'

import { ComposerStatusStack } from './index'

class ResizeObserverStub {
  disconnect() {}
  observe() {}
  unobserve() {}
}

const renderStack = (sessionId: string) =>
  render(
    <MemoryRouter>
      <I18nProvider configClient={null}>
        <ComposerStatusStack busy={false} queue={null} sessionId={sessionId} />
      </I18nProvider>
    </MemoryRouter>
  )

describe('ComposerStatusStack Loop/Kanban rows', () => {
  beforeEach(() => {
    cleanup()
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
    $kanbanStatusBySession.set({})
    $loopagentsBySession.set({})
    $previewStatusBySession.set({})
    $threadScrolledUp.set(false)
  })

  it('renders subscribed Loop roots in Tasks and active subscribed workers as visible Subagents rows', () => {
    reconcileKanbanSessionSourceForComposer({
      activeSessionId: null,
      sourceSessionId: 'logical-origin',
      source: {
        session_id: 'logical-origin',
        tasks: [
          {
            created_by: 'loop_delegation:agent',
            id: 't_subscribed_loop',
            included_child_ids: [],
            included_parent_ids: [],
            status: 'running',
            title: 'Subscribed Loop root'
          }
        ],
        workers: [
          {
            current_tool: 'search_files',
            profile: 'reviewer-qa',
            run_id: 77,
            status: 'running',
            task_id: 't_subscribed_loop',
            task_status: 'running',
            task_title: 'Subscribed Loop root',
            worker_session_id: 'worker-session-77'
          }
        ]
      }
    })

    renderStack('logical-origin')

    expect(screen.getAllByText('Subscribed Loop root')).toHaveLength(2)
    expect(screen.getByText('Loop')).toBeTruthy()
    expect(screen.getByText('reviewer-qa')).toBeTruthy()
    expect(screen.getByText('Search Files')).toBeTruthy()
  })
})
