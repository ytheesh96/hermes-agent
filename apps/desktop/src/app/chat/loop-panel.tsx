import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'

import { StatusItemRow } from '@/app/chat/composer/status-stack/status-row'
import { CompactMarkdown } from '@/components/chat/compact-markdown'
import { StatusRow } from '@/components/chat/status-row'
import { StatusSection } from '@/components/chat/status-section'
import { Button } from '@/components/ui/button'
import { Codicon } from '@/components/ui/codicon'
import { LogView } from '@/components/ui/log-view'
import { cn } from '@/lib/utils'
import type { ComposerStatusItem, StatusItemState } from '@/store/composer-status'

import type { CompactLoopTask, LoopPanelState, LoopRow, LoopTaskDetail, LoopWorkerActivity, TenantLoopTask } from './loop-state'

export type LoopTaskAction =
  | 'accept-review'
  | 'archive'
  | 'archive-loop'
  | 'ask-hermes'
  | 'block'
  | 'decompose'
  | 'details'
  | 'escalate-review'
  | 'kanban'
  | 'logs'
  | 'park'
  | 'reject-review'
  | 'start'
  | 'unblock'
  | 'worker-run'
  | 'worker-session'

const LOOP_PANEL_DEFAULT_WIDTH = 352
const LOOP_PANEL_MIN_WIDTH = 256
const LOOP_PANEL_MAX_WIDTH = 560
const LOOP_PANEL_RESIZE_STEP = 16
const LOOP_OVERVIEW_TAB_ID = 'loop-overview'

function clampLoopPanelWidth(width: number): number {
  const viewportMax = typeof window === 'undefined' ? LOOP_PANEL_MAX_WIDTH : Math.max(LOOP_PANEL_MIN_WIDTH, Math.min(LOOP_PANEL_MAX_WIDTH, window.innerWidth * 0.58))

  return Math.min(viewportMax, Math.max(LOOP_PANEL_MIN_WIDTH, Math.round(width)))
}

function statusIndicatorClass(status: string): string {
  const value = status.toLowerCase()

  if (value === 'running' || value === 'in_progress' || value === 'claimed') {
    return 'size-1.5 bg-(--ui-accent) shadow-[0_0_0.625rem_color-mix(in_srgb,var(--ui-accent)_45%,transparent)]'
  }

  if (value === 'blocked' || value === 'stale') {
    return 'size-1.5 bg-amber-500'
  }

  if (value === 'error' || value === 'failed') {
    return 'size-1.5 bg-destructive'
  }

  if (value === 'done') {
    return 'size-1.5 bg-emerald-500/80'
  }

  return 'size-1 bg-(--ui-text-quaternary) opacity-80'
}

function LoopStatusIndicator({ row }: { row: LoopRow }) {
  const draftStatus = row.status.trim().toLowerCase().replaceAll('-', '_') === 'triage'

  return (
    <span
      aria-label={`Status: ${row.status}`}
      className="grid w-3.5 shrink-0 place-items-center overflow-hidden"
      role="img"
    >
      {draftStatus ? (
        <span aria-hidden="true" className="box-border size-[0.7rem] rounded-full border border-dashed border-(--ui-text-tertiary)" />
      ) : (
        <span aria-hidden="true" className={cn('rounded-full', statusIndicatorClass(row.status))} />
      )}
    </span>
  )
}

function completedLoopRows(rows: LoopRow[]): number {
  return rows.filter(row => {
    const status = row.status.toLowerCase()

    return status === 'done' || status === 'complete' || status === 'completed'
  }).length
}

const TERMINAL_LOOP_STATUSES = new Set(['archived', 'cancelled', 'complete', 'completed', 'done'])
const FAILED_LOOP_STATUSES = new Set(['crashed', 'error', 'failed', 'failure', 'stale', 'timed_out', 'timeout'])

function normalizedLoopValue(value?: null | string): string {
  return (value || '').trim().toLowerCase().replaceAll('-', '_')
}

function attentionText(row: LoopRow): string {
  return [
    row.status,
    row.title,
    row.body,
    row.result,
    row.latestSummary,
    row.latestRun?.error,
    row.latestRun?.outcome,
    row.latestRun?.status,
    row.latestRun?.summary
  ]
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLowerCase()
}

function attentionReason(row: LoopRow): string {
  const status = normalizedLoopValue(row.status)
  const runStatus = normalizedLoopValue(row.latestRun?.status)
  const runOutcome = normalizedLoopValue(row.latestRun?.outcome)
  const text = attentionText(row)

  if (status === 'blocked') {
    return row.childCount > 0 ? `Blocked · ${row.childCount} downstream` : 'Blocked'
  }

  if (FAILED_LOOP_STATUSES.has(status) || FAILED_LOOP_STATUSES.has(runStatus) || FAILED_LOOP_STATUSES.has(runOutcome)) {
    return 'Worker handoff failed'
  }

  if (text.includes('review-required') || text.includes('review required')) {
    return 'Review required'
  }

  if (text.includes('human approval') || text.includes('needs approval') || text.includes('user acceptance')) {
    return 'Approval needed'
  }

  if (status === 'foreground_handoff') {
    return 'Foreground handoff'
  }

  return 'Needs attention'
}

function attentionScore(row: LoopRow): number {
  const status = normalizedLoopValue(row.status)
  const runStatus = normalizedLoopValue(row.latestRun?.status)
  const runOutcome = normalizedLoopValue(row.latestRun?.outcome)
  const text = attentionText(row)

  if (TERMINAL_LOOP_STATUSES.has(status) || status === 'running' || status === 'claimed' || status === 'in_progress') {
    return 0
  }

  let score = 0

  if (status === 'blocked') {
    score = 90
  } else if (FAILED_LOOP_STATUSES.has(status) || FAILED_LOOP_STATUSES.has(runStatus) || FAILED_LOOP_STATUSES.has(runOutcome)) {
    score = 88
  } else if (text.includes('review-required') || text.includes('review required')) {
    score = 82
  } else if (text.includes('human approval') || text.includes('needs approval') || text.includes('user acceptance')) {
    score = 78
  } else if (status === 'foreground_handoff') {
    score = 70
  }

  return score ? score + Math.min(row.childCount, 8) : 0
}

function attentionRows(rows: LoopRow[]): LoopRow[] {
  return rows
    .map((row, index) => ({ index, row, score: attentionScore(row) }))
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || b.row.childCount - a.row.childCount || a.index - b.index)
    .map(item => item.row)
}

const ACTIVE_OVERVIEW_STATUSES = new Set(['claimed', 'in_progress', 'running'])
const QUEUED_OVERVIEW_STATUSES = new Set(['queued', 'ready', 'scheduled', 'todo', 'triage'])
const DONE_OVERVIEW_STATUSES = new Set(['archived', 'cancelled', 'complete', 'completed', 'done'])

function isRootLoopRow(row: LoopRow): boolean {
  return row.parents.length === 0 && row.parentCount === 0
}

function rootLoopRow(rows: LoopRow[]): LoopRow | null {
  return rows.find(isRootLoopRow) || rows[0] || null
}

function isDoneLoopRow(row: LoopRow): boolean {
  return DONE_OVERVIEW_STATUSES.has(normalizedLoopValue(row.status))
}

function isActiveLoopRow(row: LoopRow): boolean {
  const status = normalizedLoopValue(row.status)

  return ACTIVE_OVERVIEW_STATUSES.has(status)
}

function isQueuedLoopRow(row: LoopRow): boolean {
  const status = normalizedLoopValue(row.status)

  return QUEUED_OVERVIEW_STATUSES.has(status)
}

function isReviewDecisionRow(row: LoopRow): boolean {
  const text = attentionText(row)

  return (
    text.includes('review-required') ||
    text.includes('review required') ||
    text.includes('review decision') ||
    text.includes('foreground acceptance') ||
    text.includes('user acceptance')
  )
}

interface RootOverviewGroups {
  active: LoopRow[]
  attention: LoopRow[]
  completed: LoopRow[]
  queued: LoopRow[]
}

function rootDescendantRows(state: LoopPanelState, root: LoopRow): LoopRow[] {
  const rowsById = new Map(state.rows.map(row => [row.taskId, row]))
  const seen = new Set<string>()

  const queue = [
    ...root.children,
    ...state.rows
      .filter(row => row.taskId !== root.taskId && row.parents.includes(root.taskId))
      .map(row => row.taskId)
  ]

  while (queue.length) {
    const taskId = queue.shift()!

    if (seen.has(taskId) || taskId === root.taskId) {
      continue
    }

    seen.add(taskId)

    const row = rowsById.get(taskId)

    if (row) {
      queue.push(...row.children)
    }
  }

  return state.rows.filter(row => seen.has(row.taskId))
}

function rootOverviewGroups(state: LoopPanelState, root: LoopRow): RootOverviewGroups {
  const descendants = rootDescendantRows(state, root)
  const attention = attentionRows(descendants)
  const attentionIds = new Set(attention.map(row => row.taskId))

  return {
    active: descendants.filter(row => !attentionIds.has(row.taskId) && isActiveLoopRow(row)),
    attention,
    queued: descendants.filter(row => !attentionIds.has(row.taskId) && isQueuedLoopRow(row)),
    completed: descendants.filter(row => !attentionIds.has(row.taskId) && isDoneLoopRow(row))
  }
}

function idsFromTask(task: TenantLoopTask, key: 'children' | 'parents'): string[] {
  const includedKey = key === 'parents' ? 'included_parent_ids' : 'included_child_ids'
  const explicit = task[includedKey] || task.links?.[key] || []

  return Array.isArray(explicit) ? explicit : []
}

function latestRunFromTaskDetail(detail?: LoopTaskDetail | null): NonNullable<LoopTaskDetail['runs']>[number] | null {
  const runs = detail?.runs || []

  return runs.length ? runs[runs.length - 1]! : null
}

function detailRowFromTaskDetail(detail?: LoopTaskDetail | null, selectedTaskId?: null | string): LoopRow | null {
  const task = detail?.task

  if (!task || (selectedTaskId && task.id !== selectedTaskId)) {
    return null
  }

  const parents = detail?.links?.parents || idsFromTask(task, 'parents')
  const children = detail?.links?.children || idsFromTask(task, 'children')
  const latestRun = task.latest_run || latestRunFromTaskDetail(detail)
  const status = task.status?.trim().toLowerCase() || 'todo'

  return {
    active: Boolean(task.current_run_id),
    assignee: task.assignee,
    body: task.body,
    childCount: children.length || task.child_count || task.children_count || 0,
    children,
    commentCount: detail?.comments?.length ?? task.comment_count ?? 0,
    depth: 0,
    externalChildTasks: task.external_child_tasks,
    externalParentTasks: task.external_parent_tasks,
    frontier: false,
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
    workerActivity: task.worker_activity || undefined,
    workspaceKind: task.workspace_kind,
    workspacePath: task.workspace_path
  }
}

function selectedRowFrom(
  state: LoopPanelState | null,
  selectedTaskId?: null | string,
  selectedTaskDetail?: LoopTaskDetail | null
): LoopRow | null {
  if (!state) {
    return null
  }

  const detailRow = detailRowFromTaskDetail(selectedTaskDetail, selectedTaskId)

  if (detailRow) {
    return detailRow
  }

  if (selectedTaskId) {
    return state.rows.find(row => row.taskId === selectedTaskId) || null
  }

  return state.rows[0] || null
}

interface LoopStackRowProps {
  onSelect: (taskId: string) => void
  row: LoopRow
  selected: boolean
}

function priorityNeedsAttention(priority?: number): boolean {
  return typeof priority === 'number' && Number.isFinite(priority) && priority > 0
}

function LoopPriorityIndicator({ row }: { row: LoopRow }) {
  if (!priorityNeedsAttention(row.priority)) {
    return null
  }

  return (
    <span
      aria-label={`Priority: ${row.priority}`}
      className="grid w-3 shrink-0 place-items-center text-[0.65rem] leading-none text-amber-500"
      role="img"
      title={`Priority: ${row.priority}`}
    >
      <span aria-hidden="true">◆</span>
    </span>
  )
}

function LoopRelationCount({ count, label }: { count: number; label: string }) {
  if (count <= 0) {
    return null
  }

  return (
    <span
      aria-label={`${label}: ${count}`}
      className="rounded bg-(--ui-fill-quaternary) px-1.5 py-0.5 font-mono text-[0.62rem] leading-none text-(--ui-text-tertiary)"
      role="img"
      title={`${label}: ${count}`}
    >
      {count}
    </span>
  )
}

function LoopStackRow({ onSelect, row, selected }: LoopStackRowProps) {
  const blockedByCount = row.parents.length || row.parentCount
  const blockingCount = row.children.length || row.childCount
  const followUpCount = row.childCount || row.children.length

  return (
    <div data-testid={`loop-card-${row.taskId}`}>
      <StatusRow
        className={cn(selected && 'bg-(--ui-row-hover-background)')}
        leading={<LoopStatusIndicator row={row} />}
        onActivate={() => onSelect(row.taskId)}
      >
        <LoopPriorityIndicator row={row} />
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-[0.73rem] leading-4',
            selected ? 'text-foreground/92' : 'text-muted-foreground/75'
          )}
          data-testid={`loop-card-title-${row.taskId}`}
          title={row.title}
        >
          {row.title}
        </span>
        <span className="shrink-0 font-mono text-[0.62rem] text-(--ui-text-quaternary)" title={row.taskId}>
          {row.taskId}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <LoopRelationCount count={blockedByCount} label="Blocked by" />
          <LoopRelationCount count={blockingCount} label="Blocking" />
          <LoopRelationCount count={followUpCount} label="Children/follow-ups" />
        </span>
      </StatusRow>
    </div>
  )
}

function LoopAttentionRow({ onSelect, row }: { onSelect: (taskId: string) => void; row: LoopRow }) {
  return (
    <StatusRow leading={<LoopStatusIndicator row={row} />} onActivate={() => onSelect(row.taskId)}>
      <span className="min-w-0 flex-1 text-[0.72rem] leading-4 text-foreground/85" title={row.title}>
        <span className="block truncate">{row.title}</span>
        <span className="block truncate text-[0.65rem] text-muted-foreground/70">{attentionReason(row)}</span>
      </span>
    </StatusRow>
  )
}

function LoopCollapsedAttentionQueue({ onSelectTaskId, rows }: { onSelectTaskId: (taskId: string) => void; rows: LoopRow[] }) {
  if (rows.length === 0) {
    return null
  }

  const visibleRows = rows.slice(0, 3)

  return (
    <div className="grid gap-0.5 rounded-lg border border-amber-500/25 bg-amber-500/8 px-1 py-1" data-testid="loop-attention-queue">
      <div className="px-1.5 pb-0.5 text-[0.67rem] font-medium uppercase tracking-wide text-amber-700 dark:text-amber-300">
        {rows.length} need attention
      </div>
      {visibleRows.map(row => (
        <LoopAttentionRow key={row.taskId} onSelect={onSelectTaskId} row={row} />
      ))}
    </div>
  )
}

interface LoopTaskStackProps {
  onRefresh?: () => void
  onSelectTaskId: (taskId: string) => void
  refreshing?: boolean
  selectedTaskId?: null | string
  state: LoopPanelState | null
}

export function LoopTaskStack({ onRefresh, onSelectTaskId, refreshing = false, selectedTaskId, state }: LoopTaskStackProps) {
  const selected = useMemo(() => selectedRowFrom(state, selectedTaskId), [selectedTaskId, state])
  const collapsedAttentionRows = useMemo(() => attentionRows(state?.rows || []), [state])

  if (!state || state.rows.length === 0) {
    return null
  }

  return (
    <StatusSection
      accessory={
        onRefresh ? (
          <Button
            aria-label="Refresh Loop tasks"
            disabled={refreshing}
            onClick={onRefresh}
            size="micro"
            title="Refresh Loop tasks"
            type="button"
            variant="text"
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </Button>
        ) : null
      }
      collapsedContent={<LoopCollapsedAttentionQueue onSelectTaskId={onSelectTaskId} rows={collapsedAttentionRows} />}
      defaultCollapsed={false}
      icon={<Codicon className="text-muted-foreground/70" name="checklist" size="0.8rem" />}
      label={`Loop ${completedLoopRows(state.rows)}/${state.rows.length}`}
    >
      {state.rows.map(row => (
        <LoopStackRow
          key={row.taskId}
          onSelect={onSelectTaskId}
          row={row}
          selected={selected?.taskId === row.taskId}
        />
      ))}
    </StatusSection>
  )
}

interface LoopPanelProps {
  enableDebugJson?: boolean
  hidden?: boolean
  onFocusTaskId?: (taskId: string) => void
  onHide?: () => void
  onRefresh?: () => void
  onSelectTaskId?: (taskId: string) => void
  onTaskAction?: (action: LoopTaskAction, row: LoopRow) => void
  open?: boolean
  selectedTaskDetail?: LoopTaskDetail | null
  selectedTaskId?: null | string
  state: LoopPanelState | null
}

function DetailSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="rounded-lg border border-(--ui-stroke-tertiary) bg-(--ui-surface-background) p-3 text-xs">
      <h3 className="m-0 mb-2 text-xs font-semibold uppercase tracking-wide text-(--ui-text-tertiary)">{title}</h3>
      {children}
    </section>
  )
}

function EmptyDetail({ children }: { children: ReactNode }) {
  return <p className="m-0 text-xs text-(--ui-text-tertiary)">{children}</p>
}

function relationTitle(taskId: string, rowById: Map<string, LoopRow>): string {
  return rowById.get(taskId)?.title || taskId
}

const INTERNAL_MARKDOWN_FIELD = /^(?:assignee|attachments|children|comments|completed_at|created_at|created_by|current_run_id|current_step_key|diagnostics|events|id|latest_run|latest_summary|links|metadata|parent_count|parents|priority|result|runs|session_id|started_at|status|tenant|warnings|workspace_kind|workspace_path)\s*:/i

function cleanTaskMarkdown(text: string): string {
  const lines = text.replaceAll('\r\n', '\n').split('\n')
  let start = 0

  if (lines[0]?.trim() === '---') {
    const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---')

    if (end > 0) {
      start = end + 1
    }
  }

  const cleaned: string[] = []
  let inFence = false

  for (const line of lines.slice(start)) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence
      cleaned.push(line)

      continue
    }

    if (!inFence && INTERNAL_MARKDOWN_FIELD.test(line.trim())) {
      continue
    }

    cleaned.push(line)
  }

  return cleaned.join('\n').replace(/^\n+|\n+$/g, '')
}

function relatedTaskById(taskId: string, relatedTasks?: CompactLoopTask[]): CompactLoopTask | null {
  return relatedTasks?.find(task => task.id === taskId) || null
}

interface DependencyLinksProps {
  emptyCopy: string
  ids: string[]
  label: string
  onSelectTaskId?: (taskId: string) => void
  relatedTasks?: CompactLoopTask[]
  rowById: Map<string, LoopRow>
}

function DependencyLinks({ emptyCopy, ids, label, onSelectTaskId, relatedTasks, rowById }: DependencyLinksProps) {
  if (ids.length === 0) {
    return <EmptyDetail>{emptyCopy}</EmptyDetail>
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {ids.map(taskId => {
        const row = rowById.get(taskId)
        const related = relatedTaskById(taskId, relatedTasks)
        const status = related?.status || row?.status
        const archived = status?.toLowerCase() === 'archived'
        const unavailable = !row && !related

        return (
          <Button
            aria-label={`Select ${label} task ${taskId}`}
            className="h-auto max-w-full px-2 py-1 text-left font-mono text-[0.68rem]"
            disabled={!onSelectTaskId}
            key={taskId}
            onClick={() => onSelectTaskId?.(taskId)}
            type="button"
            variant="secondary"
          >
            <span className="grid min-w-0 gap-0.5">
              <span className="truncate">{related?.title || relationTitle(taskId, rowById)}</span>
              {related && related.title !== taskId && <span className="truncate text-[0.6rem] text-(--ui-text-tertiary)">{taskId}</span>}
              {archived && <span className="text-[0.6rem] text-amber-600 dark:text-amber-300">Archived</span>}
              {archived && !row && <span className="text-[0.6rem] text-(--ui-text-tertiary)">Archived task details unavailable</span>}
              {unavailable && <span className="text-[0.6rem] text-(--ui-text-tertiary)">Task details unavailable</span>}
            </span>
          </Button>
        )
      })}
    </div>
  )
}

function copyTaskId(taskId: string): void {
  void navigator.clipboard?.writeText(taskId)
}

function LoopTaskActions({
  onRefresh,
  onTaskAction,
  row
}: {
  onRefresh?: () => void
  onTaskAction?: (action: LoopTaskAction, row: LoopRow) => void
  row: LoopRow
}) {
  return (
    <div className="flex flex-wrap gap-1.5" data-testid="loop-task-actions">
      <Button
        aria-label={`Copy ID for ${row.taskId}`}
        className="h-7 px-2 text-xs"
        onClick={() => copyTaskId(row.taskId)}
        type="button"
        variant="outline"
      >
        Copy ID
      </Button>
      <Button
        aria-label={`Open source task/details for ${row.taskId}`}
        className="h-7 px-2 text-xs"
        disabled={!onTaskAction}
        onClick={() => onTaskAction?.('details', row)}
        type="button"
        variant="outline"
      >
        Open source task/details
      </Button>
      <Button
        aria-label={`Refresh details for ${row.taskId}`}
        className="h-7 px-2 text-xs"
        disabled={!onRefresh}
        onClick={onRefresh}
        type="button"
        variant="outline"
      >
        Refresh
      </Button>
    </div>
  )
}

function LoopRootActions({
  archiveableTaskCount,
  decomposed,
  onTaskAction,
  root
}: {
  archiveableTaskCount: number
  decomposed: boolean
  onTaskAction?: (action: LoopTaskAction, row: LoopRow) => void
  root: LoopRow
}) {
  const status = normalizedLoopValue(root.status)
  const canSubmit = !decomposed && !TERMINAL_LOOP_STATUSES.has(status)

  return (
    <div className="flex flex-wrap gap-1.5" data-testid="loop-root-actions">
      <Button
        aria-label={`Submit ${root.taskId}`}
        className="h-7 gap-1.5 px-2 text-xs"
        disabled={!onTaskAction || !canSubmit}
        onClick={() => onTaskAction?.('decompose', root)}
        type="button"
        variant="default"
      >
        <Codicon name="send" size="0.82rem" />
        <span>Submit</span>
      </Button>
      <Button
        aria-label={`Archive Loop tasks for ${root.taskId}`}
        className="h-7 gap-1.5 px-2 text-xs"
        disabled={!onTaskAction || archiveableTaskCount === 0}
        onClick={() => onTaskAction?.('archive-loop', root)}
        type="button"
        variant="outline"
      >
        <Codicon name="archive" size="0.82rem" />
        <span>Archive</span>
      </Button>
      <Button
        aria-label={`Ask Hermes about ${root.taskId}`}
        className="h-7 gap-1.5 px-2 text-xs"
        disabled={!onTaskAction}
        onClick={() => onTaskAction?.('ask-hermes', root)}
        type="button"
        variant="outline"
      >
        <Codicon name="comment-discussion" size="0.82rem" />
        <span>Ask Hermes</span>
      </Button>
    </div>
  )
}

function descriptionHasMarkdown(text: string): boolean {
  return /(^|\n)\s{0,3}(#{1,6}\s|[-*+]\s|\d+\.\s|```|>\s|\[[^\]]+\]\([^)]+\)|- \[[ xX]\])/m.test(text) || /`[^`]+`/.test(text)
}

function TaskDescription({ text }: { text: string }) {
  const cleanedText = cleanTaskMarkdown(text)

  if (!cleanedText.trim()) {
    return <EmptyDetail>No description provided.</EmptyDetail>
  }

  return descriptionHasMarkdown(cleanedText) ? (
    <CompactMarkdown text={cleanedText} />
  ) : (
    <p className="m-0 whitespace-pre-wrap text-(--ui-text-secondary)">{cleanedText}</p>
  )
}

function rootSpecPreview(text?: null | string): string {
  const firstLine = cleanTaskMarkdown(text || '')
    .split('\n')
    .map(line => line.trim())
    .find(Boolean)

  if (!firstLine) {
    return 'No description provided.'
  }

  return firstLine.length > 96 ? `${firstLine.slice(0, 93)}...` : firstLine
}

function LoopRootSpec({ decomposed, root }: { decomposed: boolean; root: LoopRow }) {
  return (
    <DetailSection title="Loop spec">
      <details className="group/spec" data-testid="loop-root-spec" open={!decomposed}>
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-xs text-(--ui-text-secondary) [&::-webkit-details-marker]:hidden">
          <Codicon className="shrink-0 transition-transform group-open/spec:rotate-90" name="chevron-right" size="0.8rem" />
          <span className="min-w-0 flex-1 truncate">{rootSpecPreview(root.body)}</span>
        </summary>
        <div className="mt-2 border-t border-(--ui-stroke-tertiary) pt-2">
          <TaskDescription text={root.body || ''} />
        </div>
      </details>
    </DetailSection>
  )
}

function lineageItems(row: LoopRow): string[] {
  return [
    row.sourceSessionId ? `Session: ${row.sourceSessionId}` : '',
    row.tenant ? `Tenant: ${row.tenant}` : '',
    row.assignee ? `Assignee: ${row.assignee}` : '',
    row.workspaceKind ? `Workspace: ${row.workspaceKind}` : '',
    row.workspacePath || ''
  ].filter(Boolean)
}

function workerStatusLine(worker: LoopWorkerActivity): string {
  return [worker.status, worker.profile, worker.worker_pid ? `pid ${worker.worker_pid}` : ''].filter(Boolean).join(' · ')
}


function metadataLines(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return []
  }

  const record = metadata as Record<string, unknown>
  const lines: string[] = []
  const changedFiles = Array.isArray(record.changed_files) ? record.changed_files.map(String).filter(Boolean) : []
  const artifacts = Array.isArray(record.artifacts) ? record.artifacts.map(String).filter(Boolean) : []
  const verification = Array.isArray(record.verification) ? record.verification : []

  if (changedFiles.length) {
    lines.push(`Changed files: ${changedFiles.slice(0, 4).join(', ')}${changedFiles.length > 4 ? ` +${changedFiles.length - 4} more` : ''}`)
  }

  if (artifacts.length) {
    lines.push(`Artifacts: ${artifacts.slice(0, 3).join(', ')}${artifacts.length > 3 ? ` +${artifacts.length - 3} more` : ''}`)
  }

  if (verification.length) {
    lines.push(`Verification: ${verification.length} recorded check${verification.length === 1 ? '' : 's'}`)
  }

  return lines
}

function EvidenceDetails({ detail, row }: { detail?: LoopTaskDetail | null; row: LoopRow }) {
  const runs = detail?.runs || []
  const latestRun = runs.at(-1) || row.latestRun || null
  const comments = detail?.comments || []
  const metadata = latestRun?.metadata
  const metadataSummary = metadataLines(metadata)

  const summary = (() => {
    const candidate = row.latestSummary || latestRun?.summary

    if (!candidate || candidate === row.workerActivity?.summary || candidate === row.workerActivity?.summary_preview) {
      return undefined
    }

    return candidate
  })()

  const result = row.result || latestRun?.outcome || row.workerActivity?.outcome
  const error = latestRun?.error || row.workerActivity?.error || row.workerActivity?.error_preview

  if (!summary && !result && !error && metadataSummary.length === 0 && comments.length === 0 && runs.length === 0) {
    return <EmptyDetail>No structured evidence recorded yet.</EmptyDetail>
  }

  return (
    <div className="grid gap-2 text-(--ui-text-secondary)">
      {summary && <p className="m-0 whitespace-pre-wrap text-[0.72rem] leading-relaxed">{summary}</p>}
      {result && <p className="m-0 text-[0.7rem]"><span className="font-medium text-(--ui-text-primary)">Result:</span> {result}</p>}
      {error && <p className="m-0 whitespace-pre-wrap text-[0.7rem] text-destructive/90">{error}</p>}
      {metadataSummary.length > 0 && (
        <ul className="m-0 grid list-none gap-1 p-0 text-[0.68rem] text-(--ui-text-tertiary)">
          {metadataSummary.map(line => <li key={line}>{line}</li>)}
        </ul>
      )}
      {runs.length > 0 && <p className="m-0 text-[0.66rem] text-(--ui-text-tertiary)">Run history: {runs.length} recorded run{runs.length === 1 ? '' : 's'}</p>}
      {comments.length > 0 && (
        <div className="grid gap-1">
          <p className="m-0 text-[0.62rem] font-medium uppercase tracking-wide text-(--ui-text-tertiary)">Recent comments</p>
          {comments.slice(-3).map((comment, index) => (
            <p className="m-0 whitespace-pre-wrap text-[0.68rem] text-(--ui-text-secondary)" key={comment.id || index}>{comment.body || 'Empty comment'}</p>
          ))}
        </div>
      )}
    </div>
  )
}

function ReviewDecisionControls({ onTaskAction, row }: { onTaskAction?: (action: LoopTaskAction, row: LoopRow) => void; row: LoopRow }) {
  const unavailable = true

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-1.5" data-testid="loop-review-decision-controls">
        <Button aria-label="Accept review" className="h-7 px-2 text-xs" disabled={unavailable} onClick={() => onTaskAction?.('accept-review', row)} type="button" variant="default">Accept</Button>
        <Button aria-label="Reject review" className="h-7 px-2 text-xs" disabled={unavailable} onClick={() => onTaskAction?.('reject-review', row)} type="button" variant="outline">Reject</Button>
        <Button aria-label="Escalate review" className="h-7 px-2 text-xs" disabled={unavailable} onClick={() => onTaskAction?.('escalate-review', row)} type="button" variant="outline">Escalate</Button>
      </div>
      {unavailable && <EmptyDetail>Review decisions are unavailable until the gateway exposes drawer decision actions.</EmptyDetail>}
    </div>
  )
}

function WorkerActivityDetails({
  onTaskAction,
  row
}: {
  onTaskAction?: (action: LoopTaskAction, row: LoopRow) => void
  row: LoopRow
}) {
  const worker = row.workerActivity

  if (!worker) {
    return <EmptyDetail>No worker run metadata recorded for this task.</EmptyDetail>
  }

  const recentEvents = worker.recent_task_events || []

  return (
    <div className="grid gap-2 text-(--ui-text-secondary)">
      <div className="grid gap-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-[0.72rem] text-(--ui-text-primary)">Run #{worker.run_id}</span>
          {workerStatusLine(worker) ? <span className="text-[0.68rem] text-(--ui-text-tertiary)">{workerStatusLine(worker)}</span> : null}
        </div>
        {(worker.summary || worker.summary_preview || worker.error || worker.error_preview) && (
          <p className="m-0 whitespace-pre-wrap text-[0.72rem] leading-relaxed">
            {worker.summary || worker.summary_preview || worker.error || worker.error_preview}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Button
          aria-label={worker.worker_session_id ? `Open worker session ${worker.worker_session_id}` : `No worker session recorded for run #${worker.run_id}`}
          className="h-7 px-2 text-xs"
          disabled={!onTaskAction || !worker.worker_session_id}
          onClick={() => onTaskAction?.('worker-session', row)}
          type="button"
          variant="outline"
        >
          {worker.worker_session_id ? 'Open worker session' : 'No worker session'}
        </Button>
        <Button
          aria-label={`Inspect worker run #${worker.run_id}`}
          className="h-7 px-2 text-xs"
          disabled={!onTaskAction}
          onClick={() => onTaskAction?.('worker-run', row)}
          type="button"
          variant="outline"
        >
          Inspect run
        </Button>
        <Button
          aria-label={`Open worker logs for ${row.taskId}`}
          className="h-7 px-2 text-xs"
          disabled={!onTaskAction || !worker.log_tail_available}
          onClick={() => onTaskAction?.('logs', row)}
          type="button"
          variant="outline"
        >
          Worker logs
        </Button>
      </div>

      {worker.log_tail ? (
        <LogView className="max-h-32">{worker.log_tail}</LogView>
      ) : worker.log_tail_available ? (
        <EmptyDetail>Worker log exists; open logs to inspect it.</EmptyDetail>
      ) : null}

      {recentEvents.length > 0 ? (
        <div className="grid gap-0.5">
          <p className="m-0 text-[0.62rem] font-medium uppercase tracking-wide text-(--ui-text-tertiary)">Recent events</p>
          {recentEvents.slice(-5).map((event, index) => (
            <p className="m-0 font-mono text-[0.66rem] text-(--ui-text-tertiary)" key={`${event.id || index}:${event.kind}`}>
              {event.kind || 'event'}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  )
}

const loopTextValue = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined)

const loopToolLabel = (name: string): string =>
  name
    .split('_')
    .filter(Boolean)
    .map(part => part[0]!.toUpperCase() + part.slice(1))
    .join(' ') || name

const loopRecordFrom = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null

function currentToolFromLoopRecord(record: Record<string, unknown> | null): string | undefined {
  if (!record) {
    return undefined
  }

  for (const key of ['current_tool', 'currentTool', 'current_tool_name', 'tool_name', 'active_tool', 'last_tool']) {
    const value = loopTextValue(record[key])

    if (value) {
      return loopToolLabel(value)
    }
  }

  return undefined
}

function loopWorkerCurrentTool(row: LoopRow): string | undefined {
  const worker = row.workerActivity
  const direct = currentToolFromLoopRecord(worker ? (worker as unknown as Record<string, unknown>) : null)

  if (direct) {
    return direct
  }

  for (const event of (worker?.recent_task_events || []).slice().reverse()) {
    const fromPayload = currentToolFromLoopRecord(loopRecordFrom(event.payload))

    if (fromPayload) {
      return fromPayload
    }
  }

  return currentToolFromLoopRecord(loopRecordFrom(row.latestRun?.metadata))
}

function loopAgentActivityLabel(row: LoopRow): string | undefined {
  const profile = loopTextValue(row.workerActivity?.profile) || loopTextValue(row.latestRun?.profile) || loopTextValue(row.assignee)
  const currentTool = loopWorkerCurrentTool(row)

  return [profile, currentTool].filter(Boolean).join(' · ') || profile || currentTool
}

function loopOverviewItemState(row: LoopRow): StatusItemState {
  const status = normalizedLoopValue(row.status)
  const runStatus = normalizedLoopValue(row.latestRun?.status)
  const runOutcome = normalizedLoopValue(row.latestRun?.outcome)

  if (attentionScore(row) > 0 || FAILED_LOOP_STATUSES.has(status) || FAILED_LOOP_STATUSES.has(runStatus) || FAILED_LOOP_STATUSES.has(runOutcome)) {
    return 'failed'
  }

  if (isActiveLoopRow(row) || row.active) {
    return 'running'
  }

  return 'done'
}

function loopOverviewStatusItem(row: LoopRow): ComposerStatusItem {
  const queued = isQueuedLoopRow(row)

  return {
    currentTool: queued ? 'Loop' : loopAgentActivityLabel(row),
    id: `kanban-agent:${row.taskId}:${row.workerActivity?.run_id ?? row.latestRun?.id ?? 'overview'}`,
    kanbanTaskId: row.taskId,
    runId: row.workerActivity?.run_id ?? row.latestRun?.id,
    sessionId: row.workerActivity?.worker_session_id || row.latestRun?.worker_session_id || undefined,
    state: queued ? 'running' : loopOverviewItemState(row),
    title: row.title,
    todoStatus: queued ? 'pending' : undefined,
    type: queued ? 'todo' : 'kanban-agent'
  }
}

function RootOverviewGroup({
  emptyCopy,
  label,
  onOpenTaskTab,
  rows
}: {
  emptyCopy: string
  label: string
  onOpenTaskTab?: (row: LoopRow) => void
  rows: LoopRow[]
}) {
  return (
    <DetailSection title={label}>
      {rows.length === 0 ? (
        <EmptyDetail>{emptyCopy}</EmptyDetail>
      ) : (
        <div className="flex flex-col gap-0.5">
          {rows.map(row => (
            <StatusItemRow
              item={loopOverviewStatusItem(row)}
              key={row.taskId}
              onOpen={onOpenTaskTab ? () => onOpenTaskTab(row) : undefined}
            />
          ))}
        </div>
      )}
    </DetailSection>
  )
}

function LoopRootOverview({
  onOpenTaskTab,
  onTaskAction,
  root,
  state
}: {
  onOpenTaskTab?: (row: LoopRow) => void
  onTaskAction?: (action: LoopTaskAction, row: LoopRow) => void
  root: LoopRow
  state: LoopPanelState
}) {
  const groups = rootOverviewGroups(state, root)
  const groupedCount = groups.active.length + groups.attention.length + groups.queued.length + groups.completed.length
  const childCount = Math.max(root.childCount, root.children.length, groupedCount)
  const decomposed = childCount > 0
  const archiveableTaskCount = state.rows.filter(row => normalizedLoopValue(row.status) !== 'archived').length

  return (
    <div className="grid gap-3">
      <section className="rounded-lg border border-(--ui-stroke-tertiary) bg-(--ui-surface-background) p-3 text-xs">
        <div className="grid gap-2">
          <div className="flex items-center gap-2 font-medium text-(--ui-text-primary)">
            <LoopStatusIndicator row={root} />
            <h3 className="m-0 min-w-0 truncate text-sm font-semibold text-(--ui-text-primary)">{root.title}</h3>
          </div>
          <div className="font-mono text-(--ui-text-tertiary)">{root.taskId}</div>
        </div>
      </section>

      <DetailSection title="Quick actions">
        <LoopRootActions
          archiveableTaskCount={archiveableTaskCount}
          decomposed={decomposed}
          onTaskAction={onTaskAction}
          root={root}
        />
      </DetailSection>

      <LoopRootSpec decomposed={decomposed} root={root} />

      {decomposed ? (
        <div className="grid gap-2" data-testid="loop-root-execution-overview">
          <h3 className="m-0 text-xs font-semibold uppercase tracking-wide text-(--ui-text-tertiary)">Execution overview</h3>
          <RootOverviewGroup emptyCopy="No active children." label="Active/running children" onOpenTaskTab={onOpenTaskTab} rows={groups.active} />
          <RootOverviewGroup emptyCopy="No children need foreground attention." label="Needs attention" onOpenTaskTab={onOpenTaskTab} rows={groups.attention} />
          <RootOverviewGroup emptyCopy="No queued or pending children." label="Queued/pending" onOpenTaskTab={onOpenTaskTab} rows={groups.queued} />
          <RootOverviewGroup emptyCopy="No completed child evidence yet." label="Completed/audit" onOpenTaskTab={onOpenTaskTab} rows={groups.completed} />
          <DetailSection title="Audit trail">
            <EmptyDetail>Queued, completed, and attention children stay inspectable here even when they are not composer rows.</EmptyDetail>
          </DetailSection>
        </div>
      ) : null}
    </div>
  )
}

function LoopTaskDetails({
  backLabel,
  detail,
  onBack,
  onRefresh,
  onSelectTaskId,
  onTaskAction,
  row,
  rowById
}: {
  backLabel?: null | string
  detail?: LoopTaskDetail | null
  onBack?: () => void
  onRefresh?: () => void
  onSelectTaskId?: (taskId: string) => void
  onTaskAction?: (action: LoopTaskAction, row: LoopRow) => void
  row: LoopRow
  rowById: Map<string, LoopRow>
}) {
  const lineage = lineageItems(row)
  const reviewMode = isReviewDecisionRow(row)

  return (
    <div className="grid gap-3">
      {reviewMode && (
        <DetailSection title="Review decision">
          <div className="grid gap-2">
            <p className="m-0 text-xs text-(--ui-text-secondary)">{attentionReason(row)}</p>
            <ReviewDecisionControls onTaskAction={onTaskAction} row={row} />
          </div>
        </DetailSection>
      )}
      <DetailSection title="Header">
        <div className="grid gap-2">
          {backLabel && onBack && (
            <Button aria-label={`Back to ${backLabel}`} className="h-7 justify-start px-2 text-xs" onClick={onBack} type="button" variant="ghost">
              Back to {backLabel}
            </Button>
          )}
          <div className="flex items-center gap-2 font-medium text-(--ui-text-primary)">
            <LoopStatusIndicator row={row} />
            <LoopPriorityIndicator row={row} />
            <h3 className="m-0 min-w-0 truncate text-sm font-semibold text-(--ui-text-primary)">{row.title}</h3>
          </div>
          <div className="font-mono text-(--ui-text-tertiary)">{row.taskId}</div>
        </div>
      </DetailSection>

      <DetailSection title="Description">
        {row.body?.trim() ? <TaskDescription text={row.body} /> : <EmptyDetail>No description provided.</EmptyDetail>}
      </DetailSection>

      <DetailSection title="Evidence / proof">
        <EvidenceDetails detail={detail} row={row} />
      </DetailSection>

      <DetailSection title="Lineage/source">
        {lineage.length ? (
          <dl className="m-0 grid gap-1 text-(--ui-text-secondary)">
            {lineage.map(item => (
              <div className="break-all" key={item}>{item}</div>
            ))}
          </dl>
        ) : (
          <EmptyDetail>No lineage or source details available.</EmptyDetail>
        )}
      </DetailSection>

      <DetailSection title="Blocked by">
        <DependencyLinks
          emptyCopy="Not blocked by any tasks."
          ids={row.parents}
          label="blocked by"
          onSelectTaskId={onSelectTaskId}
          relatedTasks={row.externalParentTasks}
          rowById={rowById}
        />
      </DetailSection>

      <DetailSection title="Blocking">
        <DependencyLinks
          emptyCopy="Not blocking other tasks."
          ids={row.children}
          label="blocking"
          onSelectTaskId={onSelectTaskId}
          relatedTasks={row.externalChildTasks}
          rowById={rowById}
        />
      </DetailSection>

      <DetailSection title="Decomposed children/follow-ups">
        <DependencyLinks
          emptyCopy="No decomposed children or follow-ups."
          ids={row.children}
          label="blocking"
          onSelectTaskId={onSelectTaskId}
          relatedTasks={row.externalChildTasks}
          rowById={rowById}
        />
      </DetailSection>

      <DetailSection title="Worker activity">
        <WorkerActivityDetails onTaskAction={onTaskAction} row={row} />
      </DetailSection>

      <DetailSection title="Safe actions">
        <LoopTaskActions onRefresh={onRefresh} onTaskAction={onTaskAction} row={row} />
      </DetailSection>
    </div>
  )
}

interface LoopPanelTaskTab {
  taskId: string
  title: string
}

interface LoopPanelTabBarProps {
  activeTaskTabId: null | string
  baseLabel: string
  onClosePane?: () => void
  onCloseTaskTab: (taskId: string) => void
  onSelectBaseTab: () => void
  onSelectTaskTab: (taskId: string) => void
  taskTabs: LoopPanelTaskTab[]
}

function LoopPanelTabBar({
  activeTaskTabId,
  baseLabel,
  onClosePane,
  onCloseTaskTab,
  onSelectBaseTab,
  onSelectTaskTab,
  taskTabs
}: LoopPanelTabBarProps) {
  const tabs = [
    { id: LOOP_OVERVIEW_TAB_ID, label: baseLabel, taskId: null },
    ...taskTabs.map(tab => ({ id: `loop-task:${tab.taskId}`, label: tab.title, taskId: tab.taskId }))
  ]

  return (
    <div className="group/loop-tabs flex h-(--titlebar-height) shrink-0 border-b border-(--ui-stroke-tertiary) bg-(--ui-sidebar-surface-background)">
      <div
        className="flex min-w-0 flex-1 overflow-x-auto overflow-y-hidden overscroll-x-contain [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="tablist"
      >
        {tabs.map(tab => {
          const active = tab.taskId ? tab.taskId === activeTaskTabId : !activeTaskTabId
          const selectTab = tab.taskId ? () => onSelectTaskTab(tab.taskId!) : onSelectBaseTab

          return (
            <div
              className={cn(
                'group/tab relative flex h-full min-w-0 max-w-48 shrink-0 items-center text-[0.6875rem] font-medium [-webkit-app-region:no-drag] last:border-r last:border-(--ui-stroke-quaternary)',
                active
                  ? 'bg-(--ui-editor-surface-background) text-foreground [--tab-bg:var(--ui-editor-surface-background)]'
                  : 'border-r border-(--ui-stroke-quaternary) text-(--ui-text-tertiary) [--tab-bg:var(--ui-sidebar-surface-background)] hover:bg-(--chrome-action-hover) hover:text-foreground'
              )}
              data-testid={tab.taskId ? `loop-task-tab-${tab.taskId}` : 'loop-overview-tab'}
              key={tab.id}
              onAuxClick={event => {
                if (!tab.taskId || event.button !== 1) {
                  return
                }

                event.preventDefault()
                onCloseTaskTab(tab.taskId)
              }}
              onMouseDown={event => {
                if (tab.taskId && event.button === 1) {
                  event.preventDefault()
                }
              }}
            >
              {active && <span aria-hidden="true" className="absolute inset-x-0 top-0 h-px bg-(--ui-stroke-primary)" />}
              <button
                aria-selected={active}
                className="flex h-full min-w-0 max-w-full items-center overflow-hidden pl-3 pr-2 text-left outline-none"
                onClick={selectTab}
                role="tab"
                title={tab.label}
                type="button"
              >
                <span className="block min-w-0 truncate">{tab.label}</span>
              </button>
              {tab.taskId && (
                <>
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-y-0 right-0 w-9 bg-[linear-gradient(to_right,transparent,var(--tab-bg)_55%)] opacity-0 transition-opacity group-hover/tab:opacity-100 group-focus-within/tab:opacity-100"
                  />
                  <button
                    aria-label={`Close ${tab.label}`}
                    className="pointer-events-none absolute right-1.5 top-1/2 grid size-4 -translate-y-1/2 place-items-center rounded-sm text-(--ui-text-tertiary) opacity-0 transition-[background-color,color,opacity] hover:bg-(--ui-bg-secondary) hover:text-foreground focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover/tab:pointer-events-auto group-hover/tab:opacity-100 group-focus-within/tab:pointer-events-auto group-focus-within/tab:opacity-100"
                    onClick={event => {
                      event.stopPropagation()
                      onCloseTaskTab(tab.taskId)
                    }}
                    type="button"
                  >
                    <Codicon name="close" size="0.75rem" />
                  </button>
                </>
              )}
            </div>
          )
        })}
      </div>
      {onClosePane && (
        <button
          aria-label="Hide Loop panel"
          className="mr-1.5 grid size-6 shrink-0 self-center place-items-center rounded-md text-(--ui-text-tertiary) opacity-0 transition-opacity hover:bg-(--ui-control-hover-background) hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring group-hover/loop-tabs:opacity-100 [-webkit-app-region:no-drag]"
          onClick={onClosePane}
          type="button"
        >
          <Codicon name="close" size="0.75rem" />
        </button>
      )}
    </div>
  )
}

export function LoopPanel({
  enableDebugJson = false,
  hidden = false,
  onFocusTaskId,
  onHide,
  onRefresh,
  onSelectTaskId,
  onTaskAction,
  open = false,
  selectedTaskDetail,
  selectedTaskId,
  state
}: LoopPanelProps) {
  const [debugOpen, setDebugOpen] = useState(false)
  const [navigationStack, setNavigationStack] = useState<LoopRow[]>([])
  const [focusedTaskId, setFocusedTaskId] = useState<null | string>(selectedTaskId || null)
  const [taskTabs, setTaskTabs] = useState<LoopPanelTaskTab[]>([])
  const [activeTaskTabId, setActiveTaskTabId] = useState<null | string>(null)
  const internalFocusTaskIdRef = useRef<null | string>(null)
  const [panelWidth, setPanelWidth] = useState(LOOP_PANEL_DEFAULT_WIDTH)
  const stateRootTaskId = state?.rootTaskId || ''

  useEffect(() => {
    setTaskTabs([])
    setActiveTaskTabId(null)
  }, [stateRootTaskId])

  useEffect(() => {
    const nextSelectedTaskId = selectedTaskId || null

    if (internalFocusTaskIdRef.current === nextSelectedTaskId) {
      internalFocusTaskIdRef.current = null

      return
    }

    setFocusedTaskId(nextSelectedTaskId)
    setNavigationStack([])
    setActiveTaskTabId(null)
  }, [selectedTaskId])

  const selected = useMemo(
    () => selectedRowFrom(state, focusedTaskId, selectedTaskDetail),
    [focusedTaskId, selectedTaskDetail, state]
  )

  const activeTaskTabRow = useMemo(
    () => activeTaskTabId ? selectedRowFrom(state, activeTaskTabId, selectedTaskDetail) : null,
    [activeTaskTabId, selectedTaskDetail, state]
  )

  const rootRow = useMemo(() => rootLoopRow(state?.rows || []), [state])
  const rootOverviewEligible = Boolean(rootRow && (rootRow.children.length > 0 || rootRow.childCount > 0 || normalizedLoopValue(rootRow.status) === 'triage'))
  const showingRootOverview = Boolean(rootOverviewEligible && rootRow && (!focusedTaskId || focusedTaskId === rootRow.taskId))
  const renderedTaskId = activeTaskTabId || focusedTaskId

  const rowById = useMemo(() => {
    const rows = state?.rows || []
    const map = new Map(rows.map(row => [row.taskId, row]))
    const detailRow = detailRowFromTaskDetail(selectedTaskDetail, renderedTaskId)

    if (detailRow) {
      map.set(detailRow.taskId, detailRow)
    }

    return map
  }, [renderedTaskId, selectedTaskDetail, state])

  const focusDrawerTask = useCallback((taskId: string) => {
    setFocusedTaskId(taskId)
    internalFocusTaskIdRef.current = taskId

    if (onFocusTaskId) {
      onFocusTaskId(taskId)
    } else {
      onSelectTaskId?.(taskId)
    }
  }, [onFocusTaskId, onSelectTaskId])

  const selectRelatedTask = useCallback((taskId: string) => {
    if (selected && selected.taskId !== taskId) {
      setNavigationStack(stack => [...stack, selected].slice(-8))
    }

    focusDrawerTask(taskId)
  }, [focusDrawerTask, selected])

  const openTaskTab = useCallback((row: LoopRow) => {
    setTaskTabs(tabs => {
      const existingIndex = tabs.findIndex(tab => tab.taskId === row.taskId)

      if (existingIndex >= 0) {
        return tabs.map(tab => tab.taskId === row.taskId ? { ...tab, title: row.title || row.taskId } : tab)
      }

      return [...tabs, { taskId: row.taskId, title: row.title || row.taskId }]
    })
    setActiveTaskTabId(row.taskId)
    setNavigationStack([])
    focusDrawerTask(row.taskId)
  }, [focusDrawerTask])

  const selectTaskTab = useCallback((taskId: string) => {
    setActiveTaskTabId(taskId)
    setNavigationStack([])
    focusDrawerTask(taskId)
  }, [focusDrawerTask])

  const selectBaseTab = useCallback(() => {
    setActiveTaskTabId(null)
    setNavigationStack([])

    if (rootRow) {
      focusDrawerTask(rootRow.taskId)
    } else {
      setFocusedTaskId(null)
    }
  }, [focusDrawerTask, rootRow])

  const closeTaskTab = useCallback((taskId: string) => {
    const index = taskTabs.findIndex(tab => tab.taskId === taskId)

    if (index < 0) {
      return
    }

    const nextTabs = taskTabs.filter(tab => tab.taskId !== taskId)
    setTaskTabs(nextTabs)

    if (taskId !== activeTaskTabId) {
      return
    }

    const nextTab = nextTabs[index] || nextTabs[index - 1] || null
    setNavigationStack([])

    if (nextTab) {
      setActiveTaskTabId(nextTab.taskId)
      focusDrawerTask(nextTab.taskId)

      return
    }

    setActiveTaskTabId(null)

    if (rootRow) {
      focusDrawerTask(rootRow.taskId)
    } else {
      setFocusedTaskId(null)
    }
  }, [activeTaskTabId, focusDrawerTask, rootRow, taskTabs])

  const goBack = useCallback(() => {
    const previous = navigationStack.at(-1)

    if (previous) {
      focusDrawerTask(previous.taskId)
      setNavigationStack(stack => stack.slice(0, -1))
    } else if (rootRow && focusedTaskId !== rootRow.taskId) {
      focusDrawerTask(rootRow.taskId)
    }
  }, [focusDrawerTask, focusedTaskId, navigationStack, rootRow])

  const backTarget = navigationStack.at(-1)

  const detailBackLabel =
    backTarget?.taskId === rootRow?.taskId ? 'root overview' : backTarget?.title || (rootRow && focusedTaskId !== rootRow.taskId ? 'root overview' : null)

  const detailBack = detailBackLabel ? goBack : undefined
  const baseTabLabel = activeTaskTabId && rootOverviewEligible ? 'Loop overview' : showingRootOverview ? 'Loop overview' : selected?.title || rootRow?.title || 'Loop'
  const missingTaskId = activeTaskTabId || focusedTaskId

  const startResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return
    }

    event.preventDefault()
    const startX = event.clientX
    const startWidth = panelWidth

    const onPointerMove = (moveEvent: PointerEvent) => {
      setPanelWidth(clampLoopPanelWidth(startWidth - (moveEvent.clientX - startX)))
    }

    const onPointerUp = () => {
      document.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('pointerup', onPointerUp)
    }

    document.addEventListener('pointermove', onPointerMove)
    document.addEventListener('pointerup', onPointerUp, { once: true })
  }, [panelWidth])

  const resizeByKeyboard = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      setPanelWidth(width => clampLoopPanelWidth(width + LOOP_PANEL_RESIZE_STEP))
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      setPanelWidth(width => clampLoopPanelWidth(width - LOOP_PANEL_RESIZE_STEP))
    } else if (event.key === 'Home') {
      event.preventDefault()
      setPanelWidth(LOOP_PANEL_MIN_WIDTH)
    } else if (event.key === 'End') {
      event.preventDefault()
      setPanelWidth(clampLoopPanelWidth(LOOP_PANEL_MAX_WIDTH))
    }
  }, [])

  if (!state || hidden) {
    return null
  }

  return (
    <aside
      aria-hidden={false}
      className={cn(
        'relative row-start-1 min-w-0 shrink-0 overflow-hidden text-(--ui-text-secondary)',
        !open && 'hidden xl:block'
      )}
      data-layout="docked"
      data-modal="false"
      data-pane-id="loop-panel"
      data-pane-open={open ? 'true' : 'false'}
      data-pane-side="right"
      data-state={open ? 'open' : 'preview'}
      data-testid="loop-panel"
      style={{ gridColumn: '2 / 3', width: panelWidth }}
    >
      <div
        aria-label="Resize loop-panel"
        aria-orientation="vertical"
        className="group absolute bottom-0 left-0 top-0 z-20 w-1 -translate-x-1/2 cursor-col-resize [-webkit-app-region:no-drag]"
        onKeyDown={resizeByKeyboard}
        onPointerDown={startResize}
        role="separator"
        tabIndex={0}
      >
        <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-(--ui-stroke-secondary)" />
        <span className="absolute inset-y-0 left-1/2 w-(--vscode-sash-hover-size,0.25rem) -translate-x-1/2 bg-(--ui-sash-hover-border) opacity-0 transition-opacity duration-100 group-hover:opacity-100 group-focus-visible:opacity-100" />
      </div>

      <div className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-(--ui-editor-surface-background) pt-(--titlebar-height)">
        <LoopPanelTabBar
          activeTaskTabId={activeTaskTabId}
          baseLabel={baseTabLabel}
          onClosePane={onHide}
          onCloseTaskTab={closeTaskTab}
          onSelectBaseTab={selectBaseTab}
          onSelectTaskTab={selectTaskTab}
          taskTabs={taskTabs}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col p-3">
          {state.message && (
            <div
              className={cn(
                'mb-3 rounded-lg border px-2 py-1.5 text-xs',
                state.status === 'stale'
                  ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                  : 'border-destructive/30 bg-destructive/10 text-destructive'
              )}
            >
              {state.message}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-auto">
            {activeTaskTabId ? (
              activeTaskTabRow ? (
                <div className="grid gap-3">
                  <h3 className="m-0 text-xs font-semibold uppercase tracking-wide text-(--ui-text-tertiary)">Loop details</h3>
                  <LoopTaskDetails
                    backLabel={null}
                    detail={selectedTaskDetail}
                    onRefresh={onRefresh}
                    onSelectTaskId={selectRelatedTask}
                    onTaskAction={onTaskAction}
                    row={activeTaskTabRow}
                    rowById={rowById}
                  />
                </div>
              ) : (
                <section className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                  <h3 className="m-0 mb-2 text-xs font-semibold uppercase tracking-wide">Selected task unavailable</h3>
                  <p className="m-0">
                    Task <span className="font-mono">{activeTaskTabId}</span> is missing from the latest Loop source. It may have been archived,
                    deleted, or refreshed out of this session lineage. Select another tab or close the panel.
                  </p>
                </section>
              )
            ) : showingRootOverview && rootRow ? (
              <div className="grid gap-3">
                <h3 className="m-0 text-xs font-semibold uppercase tracking-wide text-(--ui-text-tertiary)">Loop overview</h3>
                <LoopRootOverview
                  onOpenTaskTab={openTaskTab}
                  onTaskAction={onTaskAction}
                  root={rootRow}
                  state={state}
                />
              </div>
            ) : selected ? (
              <div className="grid gap-3">
                <h3 className="m-0 text-xs font-semibold uppercase tracking-wide text-(--ui-text-tertiary)">Loop details</h3>
                <LoopTaskDetails
                  backLabel={detailBackLabel}
                  detail={selectedTaskDetail}
                  onBack={detailBack}
                  onRefresh={onRefresh}
                  onSelectTaskId={selectRelatedTask}
                  onTaskAction={onTaskAction}
                  row={selected}
                  rowById={rowById}
                />
              </div>
            ) : missingTaskId ? (
              <section className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
                <h3 className="m-0 mb-2 text-xs font-semibold uppercase tracking-wide">Selected task unavailable</h3>
                <p className="m-0">
                  Task <span className="font-mono">{missingTaskId}</span> is missing from the latest Loop source. It may have been archived,
                  deleted, or refreshed out of this session lineage. Select another row or close the panel.
                </p>
              </section>
            ) : (
              <p className="m-0 rounded-lg border border-dashed border-(--ui-stroke-tertiary) p-3 text-xs text-(--ui-text-tertiary)">
                No Loop rows yet. Ask Hermes to read or mutate the Loop graph.
              </p>
            )}
          </div>

          {enableDebugJson && (
            <div className="mt-3 border-t border-(--ui-stroke-tertiary) pt-3">
              <Button className="h-7 px-2 text-xs" onClick={() => setDebugOpen(value => !value)} type="button" variant="ghost">
                {debugOpen ? 'Hide debug JSON' : 'Show debug JSON'}
              </Button>
              {debugOpen && (
                <pre className="mt-2 max-h-36 overflow-auto rounded border border-(--ui-stroke-tertiary) bg-(--ui-fill-quaternary) p-2 text-[0.65rem] text-(--ui-text-secondary)">
                  {state.rawJson}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
