import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { I18nProvider } from '@/i18n'

import { StatusItemRow } from './status-row'

afterEach(() => cleanup())

describe('StatusItemRow worker visuals', () => {
  it('badges Loop workers distinctly from delegate subagents', () => {
    const { rerender } = render(
      <I18nProvider configClient={null}>
        <StatusItemRow
          item={{
            id: 'worker:t_loop:7',
            state: 'running',
            title: 'Implement Loop worker parity',
            type: 'loop-worker'
          }}
        />
      </I18nProvider>
    )

    expect(screen.getByText('Kanban')).toBeTruthy()

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
})
