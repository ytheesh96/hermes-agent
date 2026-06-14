import type { ChatMessage, ChatMessagePart } from '@/lib/chat-messages'

export type LoopPanelStatus = 'error' | 'ready' | 'stale'

export interface LoopLatestRun {
  error?: null | string
  id?: number
  metadata?: unknown
  outcome?: null | string
  profile?: null | string
  status?: null | string
  summary?: null | string
  task_id?: string
  worker_session_id?: null | string
}

export interface LoopTaskEvent {
  created_at?: number
  id?: number
  kind?: string
  payload?: null | unknown
  run_id?: null | number
  task_id?: string
}

export interface LoopWorkerActivity {
  claim_expires?: null | number
  ended_at?: null | number
  error?: null | string
  error_preview?: null | string
  last_heartbeat_at?: null | number
  log_path?: null | string
  log_size_bytes?: number
  log_tail?: null | string
  log_tail_available?: boolean
  log_tail_truncated?: boolean
  outcome?: null | string
  profile?: null | string
  recent_task_events?: LoopTaskEvent[]
  run_id: number
  started_at?: null | number
  status?: null | string
  summary?: null | string
  summary_preview?: null | string
  task_id: string
  task_status?: null | string
  task_title?: null | string
  worker_pid?: null | number
  worker_session_id?: null | string
}

export type LoopWorkerState = 'blocked' | 'done' | 'failed' | 'running' | 'stale' | 'waiting'

export interface LoopWorkerRun {
  action: 'inspect-run' | 'open-session'
  attention: boolean
  claimExpires?: null | number
  elapsedSeconds?: number
  endedAt?: null | number
  error?: null | string
  finishedAgeSeconds?: number
  heartbeatAgeSeconds?: number
  latestText?: string
  logTail?: null | string
  logTailAvailable: boolean
  logTailTruncated: boolean
  profile?: null | string
  recentEvents: LoopTaskEvent[]
  runId: number
  startedAt?: null | number
  state: LoopWorkerState
  status?: null | string
  taskId: string
  taskStatus?: null | string
  taskTitle: string
  workerPid?: null | number
  workerSessionId?: null | string
}

export interface LoopWorkerCounts {
  attention: number
  running: number
  total: number
}

export interface CompactLoopTask {
  assignee?: null | string
  completed_at?: null | number
  created_at?: null | number
  id: string
  session_id?: null | string
  status?: null | string
  tenant?: null | string
  title?: null | string
}

export interface TenantLoopTask {
  age?: Record<string, null | number>
  assignee?: null | string
  body?: null | string
  child_count?: number
  children_count?: number
  comment_count?: number
  completed_at?: null | number
  created_at?: number
  created_by?: null | string
  current_run_id?: null | number
  current_step_key?: null | string
  diagnostics?: unknown[]
  external_child_tasks?: CompactLoopTask[]
  external_parent_tasks?: CompactLoopTask[]
  id: string
  included_child_ids?: string[]
  included_parent_ids?: string[]
  latest_run?: null | LoopLatestRun
  latest_summary?: null | string
  links?: {
    children?: string[]
    parents?: string[]
  }
  parent_count?: number
  parents_count?: number
  priority?: number
  result?: null | string
  session_id?: null | string
  started_at?: null | number
  status: string
  tenant?: null | string
  title: string
  warnings?: unknown
  worker_activity?: null | Omit<LoopWorkerActivity, 'task_id' | 'task_status' | 'task_title'>
  workspace_kind?: null | string
  workspace_path?: null | string
}

export interface TenantLoopSource {
  external_links?: { child_id?: string; parent_id?: string }[]
  include_archived?: boolean
  latest_event_id?: number
  lineage_session_ids?: string[]
  links?: { child_id?: string; parent_id?: string }[]
  now?: number
  session_id?: string
  tasks?: TenantLoopTask[]
  tenant?: null | string
  tenants?: string[]
  workers?: LoopWorkerActivity[]
}

export interface LoopTaskComment {
  author?: null | string
  body?: null | string
  created_at?: number
  id?: number
  task_id?: string
}

export interface LoopTaskRun extends LoopLatestRun {
  ended_at?: null | number
  outcome?: null | string
  started_at?: null | number
}

// Normal Loop side-panel data contract.
//
// The panel should render from normalized task metadata, not from the debug
// raw JSON block. Its list/selection rows are derived from
// GET /api/plugins/kanban/session-source (see getLoopSessionSource), while the
// focused selected-task fetch comes from GET /api/plugins/kanban/tasks/:id (see
// getLoopTaskDetail). Field ownership:
// - title/status/body, assignee, result, latest_summary, workspace_kind/path:
//   row.task (TenantLoopTask) from session-source; detail.task carries the same
//   full task shape when fetched.
// - parents/children: row.parents/row.children, computed from
//   included_parent_ids/included_child_ids, falling back to links.parents/children.
//   The focused detail also returns links for the selected task. IDs resolve to
//   display labels through LoopPanel's rowById map; missing rows intentionally
//   display the raw task id and remain selectable when onSelectTaskId exists.
// - comments: focused detail.comments; absent/empty means []. Use the row's
//   commentCount as a preview-only fallback copy, not as rendered comment text.
// - latest run/result/summary: row.latestRun, row.result, row.latestSummary
//   (latest_summary || latest_run.summary). detail.runs is the full history for
//   future expansion; absent/empty means no run history.
// - safe task actions: the UI derives conservative non-destructive affordances from
//   normalized status until a backend capability list exists. Mutating actions are
//   emitted only through explicit user clicks via LoopPanel.onTaskAction.
export interface LoopTaskDetail {
  comments?: LoopTaskComment[]
  links?: {
    children?: string[]
    parents?: string[]
  }
  runs?: LoopTaskRun[]
  task?: TenantLoopTask
}

export interface LoopRow {
  active: boolean
  assignee?: null | string
  body?: null | string
  childCount: number
  children: string[]
  commentCount: number
  depth: number
  externalChildTasks?: CompactLoopTask[]
  externalParentTasks?: CompactLoopTask[]
  frontier: boolean
  latestRun?: null | LoopLatestRun
  latestSummary?: null | string
  parentCount: number
  parents: string[]
  priority?: number
  rawTask?: TenantLoopTask
  result?: null | string
  sourceSessionId?: null | string
  status: string
  taskId: string
  tenant?: null | string
  title: string
  workspaceKind?: null | string
  workspacePath?: null | string
}

export interface LoopPanelState {
  message: string
  rawJson: string
  revision: number
  rootTaskId: string
  rows: LoopRow[]
  status: LoopPanelStatus
}

const ARCHIVED_STATUSES = new Set(['archived'])
const COMPLETE_STATUSES = new Set(['done', 'complete', 'completed', 'cancelled', 'archived'])
const ACTIVE_STATUSES = new Set(['ready', 'running', 'claimed', 'in_progress'])
const RUNNABLE_STATUSES = new Set(['ready', 'running', 'claimed', 'in_progress', 'todo'])
const WAITING_WORKER_STATUSES = new Set(['queued', 'ready', 'todo'])
const SUCCESS_RUN_OUTCOMES = new Set(['success', 'succeeded', 'ok'])

const FAILED_RUN_STATES = new Set([
  'error',
  'failed',
  'crashed',
  'timed_out',
  'timeout',
  'interrupted',
  'spawn_failed',
  'gave_up'
])

const DEFAULT_STALE_HEARTBEAT_SECONDS = 10 * 60

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function parseRecord(value: unknown): Record<string, unknown> | null {
  if (isRecord(value)) {
    return value
  }

  if (typeof value !== 'string' || !value.trim()) {
    return null
  }

  try {
    const parsed = JSON.parse(value)

    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key]

  return typeof value === 'string' ? value : ''
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  const n = typeof value === 'number' ? value : Number(value)

  return Number.isFinite(n) ? n : 0
}

function booleanField(record: Record<string, unknown>, key: string): boolean {
  return record[key] === true
}

function stringArrayField(record: Record<string, unknown>, key: string): string[] {
  const value = record[key]

  return Array.isArray(value) ? value.map(item => String(item)).filter(Boolean) : []
}

function rawJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function normalizedStatus(status: unknown): string {
  return typeof status === 'string' && status.trim() ? status.trim().toLowerCase() : 'todo'
}

function secondsBetween(later: number | null | undefined, earlier: number | null | undefined): number | undefined {
  if (typeof later !== 'number' || typeof earlier !== 'number') {
    return undefined
  }

  return Math.max(0, Math.round(later - earlier))
}

function loopWorkerState(
  worker: LoopWorkerActivity,
  nowSeconds: number,
  staleHeartbeatSeconds: number
): LoopWorkerState {
  const status = normalizedStatus(worker.status)
  const taskStatus = worker.task_status ? normalizedStatus(worker.task_status) : ''
  const outcome = normalizedStatus(worker.outcome)
  const active = ACTIVE_STATUSES.has(status) || ACTIVE_STATUSES.has(taskStatus)
  const heartbeatAge = secondsBetween(nowSeconds, worker.last_heartbeat_at)

  if (taskStatus === 'blocked' || outcome === 'blocked') {
    return 'blocked'
  }

  if (FAILED_RUN_STATES.has(status) || FAILED_RUN_STATES.has(outcome)) {
    return 'failed'
  }

  if (active && (heartbeatAge === undefined || heartbeatAge > staleHeartbeatSeconds)) {
    return 'stale'
  }

  if (active) {
    return 'running'
  }

  if (WAITING_WORKER_STATUSES.has(status) || WAITING_WORKER_STATUSES.has(taskStatus)) {
    return 'waiting'
  }

  return SUCCESS_RUN_OUTCOMES.has(outcome) || COMPLETE_STATUSES.has(status) ? 'done' : 'failed'
}

export function normalizeLoopWorkers(
  source: TenantLoopSource | null | undefined,
  opts: { nowSeconds?: number; staleHeartbeatSeconds?: number } = {}
): LoopWorkerRun[] {
  const workers: LoopWorkerActivity[] = [
    ...(source?.workers ?? []),
    ...(source?.tasks ?? []).flatMap(task =>
      task.worker_activity
        ? [
            {
              ...task.worker_activity,
              task_id: task.id,
              task_status: task.status,
              task_title: task.title
            }
          ]
        : []
    )
  ]

  if (!workers.length) {
    return []
  }

  const nowSeconds = opts.nowSeconds ?? source?.now ?? Math.round(Date.now() / 1000)
  const staleHeartbeatSeconds = opts.staleHeartbeatSeconds ?? DEFAULT_STALE_HEARTBEAT_SECONDS

  return workers.map(worker => {
    const state = loopWorkerState(worker, nowSeconds, staleHeartbeatSeconds)
    const active = state === 'running' || state === 'stale'
    const failed = state === 'failed' || state === 'blocked' || state === 'stale'
    const latestText = worker.error || worker.error_preview || worker.summary || worker.summary_preview || worker.log_tail || undefined

    return {
      action: worker.worker_session_id ? 'open-session' : 'inspect-run',
      attention: failed,
      claimExpires: worker.claim_expires,
      elapsedSeconds: secondsBetween(worker.ended_at ?? nowSeconds, worker.started_at),
      endedAt: worker.ended_at,
      error: worker.error,
      finishedAgeSeconds: worker.ended_at ? secondsBetween(nowSeconds, worker.ended_at) : undefined,
      heartbeatAgeSeconds: secondsBetween(nowSeconds, worker.last_heartbeat_at),
      latestText,
      logTail: worker.log_tail,
      logTailAvailable: worker.log_tail_available === true || Boolean(worker.log_tail),
      logTailTruncated: worker.log_tail_truncated === true,
      profile: worker.profile,
      recentEvents: worker.recent_task_events || [],
      runId: worker.run_id,
      startedAt: worker.started_at,
      state,
      status: worker.status,
      taskId: worker.task_id,
      taskStatus: worker.task_status,
      taskTitle: worker.task_title || worker.task_id,
      workerPid: worker.worker_pid,
      workerSessionId: worker.worker_session_id,
      ...(active ? {} : { claimExpires: worker.claim_expires })
    }
  })
}

export function loopWorkerCounts(workers: readonly LoopWorkerRun[]): LoopWorkerCounts {
  return workers.reduce(
    (acc, worker) => ({
      attention: acc.attention + (worker.attention ? 1 : 0),
      running: acc.running + (worker.state === 'running' ? 1 : 0),
      total: acc.total + 1
    }),
    { attention: 0, running: 0, total: 0 }
  )
}

function taskParents(task: TenantLoopTask): string[] {
  const explicit = task.included_parent_ids || task.links?.parents || []
  const external = task.external_parent_tasks?.map(parent => parent.id).filter(Boolean) || []

  return Array.from(new Set([...explicit, ...external]))
}

function taskChildren(task: TenantLoopTask): string[] {
  const explicit = task.included_child_ids || task.links?.children || []
  const external = task.external_child_tasks?.map(child => child.id).filter(Boolean) || []

  return Array.from(new Set([...explicit, ...external]))
}

function depthByTaskId(tasks: readonly TenantLoopTask[]): Map<string, number> {
  const depths = new Map<string, number>()
  const taskIds = new Set(tasks.map(task => task.id))
  let changed = true

  for (const task of tasks) {
    depths.set(task.id, 0)
  }

  for (let pass = 0; pass < Math.max(tasks.length, 1) && changed; pass += 1) {
    changed = false

    for (const task of tasks) {
      const parentDepth = taskParents(task).reduce(
        (maxDepth, parentId) => Math.max(maxDepth, depths.get(parentId) ?? 0),
        -1
      )

      const nextDepth = parentDepth >= 0 ? parentDepth + 1 : 0

      if (nextDepth > (depths.get(task.id) ?? 0)) {
        depths.set(task.id, nextDepth)
        changed = true
      }
    }
  }

  return depths
}

function tenantRowFromTask(task: TenantLoopTask, depths: Map<string, number>): LoopRow {
  const parents = taskParents(task)
  const children = taskChildren(task)
  const status = normalizedStatus(task.status)
  const latestRun = task.latest_run || null
  const latestRunActive = ACTIVE_STATUSES.has(normalizedStatus(latestRun?.status))
  const unfinishedRunnable = RUNNABLE_STATUSES.has(status) && !COMPLETE_STATUSES.has(status)

  return {
    active: ACTIVE_STATUSES.has(status) || latestRunActive || Boolean(task.current_run_id),
    assignee: task.assignee,
    body: task.body,
    childCount: children.length || task.child_count || task.children_count || 0,
    children,
    commentCount: task.comment_count || 0,
    depth: depths.get(task.id) || 0,
    externalChildTasks: task.external_child_tasks || [],
    externalParentTasks: task.external_parent_tasks || [],
    frontier: unfinishedRunnable,
    latestRun,
    latestSummary: task.latest_summary || latestRun?.summary || null,
    parentCount: parents.length || task.parent_count || task.parents_count || 0,
    parents,
    priority: task.priority,
    rawTask: task,
    result: task.result,
    sourceSessionId: task.session_id,
    status,
    taskId: task.id,
    tenant: task.tenant,
    title: task.title || task.id,
    workspaceKind: task.workspace_kind,
    workspacePath: task.workspace_path
  }
}

export function deriveLoopPanelStateFromTenantSource(source: TenantLoopSource | null | undefined): LoopPanelState | null {
  if (!source) {
    return null
  }

  const tasks = (source.tasks || []).filter(
    task => task.id && (source.include_archived || !ARCHIVED_STATUSES.has(normalizedStatus(task.status)))
  )

  const depths = depthByTaskId(tasks)
  const rows = tasks.map(task => tenantRowFromTask(task, depths))
  const rootTaskId = source.tenant || source.session_id || source.lineage_session_ids?.[0] || ''

  return {
    message: '',
    rawJson: rawJson(source),
    revision: source.latest_event_id || 0,
    rootTaskId,
    rows,
    status: 'ready'
  }
}

function rootTaskIdFrom(args: unknown, result: Record<string, unknown>): string {
  return stringField(result, 'root_task_id') || stringField(parseRecord(args) || {}, 'root_task_id')
}

function rowFromNode(value: unknown): LoopRow | null {
  const node = parseRecord(value)

  if (!node) {
    return null
  }

  const taskId = stringField(node, 'task_id') || stringField(node, 'id')
  const title = stringField(node, 'title')

  if (!taskId || !title) {
    return null
  }

  const parents = stringArrayField(node, 'parents')

  return {
    active: booleanField(node, 'active'),
    childCount: numberField(node, 'child_count'),
    children: stringArrayField(node, 'children'),
    commentCount: numberField(node, 'comment_count'),
    depth: numberField(node, 'depth'),
    frontier: booleanField(node, 'frontier'),
    parentCount: parents.length || numberField(node, 'parent_count'),
    parents,
    priority: numberField(node, 'priority') || undefined,
    status: stringField(node, 'status') || 'triage',
    taskId,
    title: title || taskId
  }
}

function rowsFrom(result: Record<string, unknown>): LoopRow[] {
  const nodes = result.nodes

  if (!Array.isArray(nodes)) {
    return []
  }

  return nodes.map(rowFromNode).filter((row): row is LoopRow => Boolean(row))
}

function statusFrom(result: Record<string, unknown>): LoopPanelStatus {
  if (result.ok !== false) {
    return 'ready'
  }

  return stringField(result, 'error') === 'stale_revision' ? 'stale' : 'error'
}

function messageFrom(status: LoopPanelStatus, result: Record<string, unknown>): string {
  if (status === 'ready') {
    return ''
  }

  return stringField(result, 'message') || stringField(result, 'error') || 'Loop graph update failed'
}

function loopToolParts(messages: readonly ChatMessage[]): Extract<ChatMessagePart, { type: 'tool-call' }>[] {
  return messages.flatMap(message =>
    message.parts.filter(
      (part): part is Extract<ChatMessagePart, { type: 'tool-call' }> =>
        part.type === 'tool-call' && part.toolName === 'loop_graph' && part.result !== undefined
    )
  )
}

export function deriveLoopPanelState(messages: readonly ChatMessage[]): LoopPanelState | null {
  let state: LoopPanelState | null = null

  for (const part of loopToolParts(messages)) {
    const result = parseRecord(part.result)

    if (!result) {
      continue
    }

    const status = statusFrom(result)

    const previousState = state
    const rootTaskId: string = rootTaskIdFrom(part.args, result) || previousState?.rootTaskId || ''

    const revision: number =
      numberField(result, 'graph_revision') || numberField(result, 'current_revision') || previousState?.revision || 0

    const nextRows = rowsFrom(result)

    if (status === 'ready') {
      state = {
        message: '',
        rawJson: rawJson(result),
        revision,
        rootTaskId,
        rows: nextRows,
        status
      }

      continue
    }

    state = {
      message: messageFrom(status, result),
      rawJson: rawJson(result),
      revision: state?.revision || revision,
      rootTaskId,
      rows: state?.rows || [],
      status
    }
  }

  return state
}
