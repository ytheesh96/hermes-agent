import type { LoopRow } from './loop-state'

function rowTitle(row: LoopRow): string {
  return row.title?.trim() || row.taskId
}

function rowNeedsIntake(row: LoopRow): boolean {
  const intake = row.loopIntake

  if (!intake?.needed) {
    return false
  }

  const state = (intake.state || '').trim().toLowerCase()

  return intake.dispatchable !== true && !['spec-ready', 'spec_ready', 'approved'].includes(state)
}

export function buildLoopChatDraft(row: LoopRow): string {
  const title = rowTitle(row)

  if (!rowNeedsIntake(row)) {
    return title ? `Help me with Loop task ${row.taskId}: ${title}` : `Help me with Loop task ${row.taskId}.`
  }

  return [
    `For Loop row ${row.taskId} (${title}): spec this rough task immediately using the current conversation context.`,
    'Treat this row as the real Loop/Kanban root. Read it with loop_graph, then update this root itself with loop_graph update_node.',
    "Write a concise executable title and body with: Objective, Context, Acceptance criteria, Constraints and assumptions, Verification, and Original request. Preserve the user's rough idea under Original request even if you improve the title.",
    'Choose a suggested_owner only when the likely worker profile is clear. Ask one clarify question only if a missing answer materially blocks a safe, useful spec; otherwise make reasonable assumptions and record them.',
    'Do not dispatch, decompose, delegate, promote the task to ready, or create execution tasks. Stop after updating the root so the user can review and explicitly submit it.'
  ].join('\n')
}
