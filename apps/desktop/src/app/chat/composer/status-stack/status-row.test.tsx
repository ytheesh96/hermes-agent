import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { I18nProvider } from '@/i18n'

import { StatusItemRow } from './status-row'

afterEach(() => cleanup())

describe('StatusItemRow worker visuals', () => {
  it('renders Kanban agents without a distinct badge', () => {
    const { rerender } = render(
      <I18nProvider configClient={null}>
        <StatusItemRow
          item={{
            id: 'kanban-agent:t_loop:7',
            currentTool: 'peacock · Terminal',
            state: 'running',
            title: 'Implement Loop worker parity',
            type: 'kanban-agent'
          }}
        />
      </I18nProvider>
    )

    expect(screen.queryByText('Kanban')).toBeNull()
    expect(screen.getByText('Peacock · Terminal')).toBeTruthy()

    rerender(
      <I18nProvider configClient={null}>
        <StatusItemRow
          item={{
            id: 'subagent-1',
            state: 'running',
            title: 'Review diff',
            type: 'subagent'
          }}
        />
      </I18nProvider>
    )

    expect(screen.queryByText('Kanban')).toBeNull()
  })

  it('renders Loop as the secondary status for Loop task rows only', () => {
    const { rerender } = render(
      <I18nProvider configClient={null}>
        <StatusItemRow
          item={{
            currentTool: 'Loop',
            id: 'kanban-task:t_loop',
            kanbanTaskId: 't_loop',
            state: 'running',
            title: 'Durable root task',
            todoStatus: 'pending',
            type: 'todo'
          }}
        />
      </I18nProvider>
    )

    expect(screen.getByText('Loop')).toBeTruthy()

    rerender(
      <I18nProvider configClient={null}>
        <StatusItemRow
          item={{
            id: 'todo:local',
            state: 'running',
            title: 'Local checklist task',
            todoStatus: 'pending',
            type: 'todo'
          }}
        />
      </I18nProvider>
    )

    expect(screen.queryByText('Loop')).toBeNull()
  })
})
