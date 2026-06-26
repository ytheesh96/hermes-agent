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

  it('turns intake-needed rows into a graph-first planning prompt', () => {
    const row = deriveLoopPanelStateFromTenantSource(titleOnlyIntakeSource)!.rows[0]!
    const draft = buildLoopChatDraft(row)

    expect(draft).toContain('For Loop row t_intake (Launch a Peacock workflow)')
    expect(draft).toContain('start the graph-first Loop intake path')
    expect(draft).toContain('Treat this row as the real Loop/Kanban root')
    expect(draft).toContain('Use the Loop graph as the exploration surface')
    expect(draft).toContain('lightweight planning nodes')
    expect(draft).toContain('without creating scheduled Kanban tasks')
    expect(draft).toContain('The clarify choices must match those planning nodes')
    expect(draft).toContain('delete/archive unchosen sibling planning nodes')
    expect(draft).toContain('delegate_task(mode="loop")')
    expect(draft).toContain('Do not promote planning nodes to ready')
    expect(draft).toContain('origin activation')
    expect(draft).not.toContain('scheduled option tasks')
    expect(draft).not.toContain('Interview me relentlessly')
    expect(draft).not.toContain('Resolved decisions')
  })

  it('shows planning nodes from the lightweight planning projection', () => {
    const state = deriveLoopPanelStateFromTenantSource({
      latest_event_id: 2,
      planning_links: [{ parent_id: 't_intake', child_id: 'plan:option-a' }],
      planning_nodes: [
        {
          active: true,
          body: 'Description: option A',
          branch_kind: 'alternative',
          decision_group_id: 'choice-1',
          execution_task_id: 't_exec',
          frontier: true,
          id: 'plan:option-a',
          included_parent_ids: ['t_intake'],
          is_planning_node: true,
          selection_state: 'candidate',
          status: 'scheduled',
          suggested_owner: 'planner',
          title: 'Option A'
        }
      ],
      root_task_id: 't_intake',
      session_id: 'session-intake',
      tasks: titleOnlyIntakeSource.tasks
    })

    const planningRow = state!.rows.find(row => row.taskId === 'plan:option-a')!
    expect(planningRow.planningNode).toBe(true)
    expect(planningRow.parents).toEqual(['t_intake'])
    expect(planningRow.active).toBe(true)
    expect(planningRow.frontier).toBe(true)
    expect(planningRow.executionTaskId).toBe('t_exec')
    expect(planningRow.suggestedOwner).toBe('planner')

    const draft = buildLoopChatDraft(planningRow)
    expect(draft).toContain('lightweight planning node, not a dispatchable Kanban task')
    expect(draft).toContain('delegate_task(mode="loop"')
    expect(draft).toContain('execution_task_id')
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
