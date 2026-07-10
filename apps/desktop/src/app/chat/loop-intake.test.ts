import { describe, expect, it } from 'vitest'

import { buildLoopChatDraft } from './loop-intake'
import { deriveLoopPanelStateFromTenantSource, type TenantLoopSource } from './loop-state'

const titleOnlyIntakeSource: TenantLoopSource = {
  latest_event_id: 1,
  root_task_id: 't_intake',
  session_id: 'session-intake',
  tasks: [
    {
      body: null,
      created_by: 'loop:t_intake',
      id: 't_intake',
      status: 'scheduled',
      tenant: 'session-intake',
      title: 'Launch a Peacock workflow',
      loop_intake: {
        dispatchable: false,
        needed: true,
        source: 'slash_loop_draft',
        state: 'drafted'
      }
    }
  ]
}

describe('Loop intake foreground trigger', () => {
  it('derives durable intake state onto Loop rows', () => {
    const state = deriveLoopPanelStateFromTenantSource(titleOnlyIntakeSource)

    expect(state?.rows[0]?.loopIntake).toEqual({
      dispatchable: false,
      needed: true,
      source: 'slash_loop_draft',
      state: 'drafted'
    })
  })

  it('turns intake-needed rows into an immediate root-spec prompt', () => {
    const row = deriveLoopPanelStateFromTenantSource(titleOnlyIntakeSource)!.rows[0]!
    const draft = buildLoopChatDraft(row)

    expect(draft).toContain('For Loop row t_intake (Launch a Peacock workflow)')
    expect(draft).toContain('spec this rough task immediately')
    expect(draft).toContain('Treat this row as the real Loop/Kanban root')
    expect(draft).toContain('loop_graph update_node')
    expect(draft).toContain('Acceptance criteria')
    expect(draft).toContain('Original request')
    expect(draft).toContain('Ask one clarify question only if')
    expect(draft).toContain('Do not dispatch, decompose, delegate')
    expect(draft).not.toContain('create the next decision branch')
  })

  it('ignores legacy planning projections', () => {
    const source = {
      ...titleOnlyIntakeSource,
      planning_links: [{ parent_id: 't_intake', child_id: 'plan:option-a' }],
      planning_nodes: [{ id: 'plan:option-a', status: 'scheduled', title: 'Option A' }]
    } as TenantLoopSource

    expect(deriveLoopPanelStateFromTenantSource(source)?.rows.map(row => row.taskId)).toEqual(['t_intake'])
  })

  it('keeps ordinary Loop chat drafts for rows without durable intake state', () => {
    const state = deriveLoopPanelStateFromTenantSource({
      latest_event_id: 1,
      root_task_id: 't_ready',
      session_id: 'session-ready',
      tasks: [
        {
          body: 'Already specified',
          created_by: 'loop:t_ready',
          id: 't_ready',
          status: 'scheduled',
          tenant: 'session-ready',
          title: 'Ready spec'
        }
      ]
    })

    expect(buildLoopChatDraft(state!.rows[0]!)).toBe('Help me with Loop task t_ready: Ready spec')
  })
})
