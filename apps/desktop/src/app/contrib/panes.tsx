/**
 * Real-data panes + composable bar items for the contrib root:
 *
 *  - `PreviewRailPane` — the REAL ChatPreviewRail; files-pane clicks feed it.
 *  - `FilesPane` — real file browser; activating a file opens it in preview.
 *  - Core statusbar items with LIVE store-backed labels, registered as DATA
 *    contributions (`area: 'statusBar.left' / 'statusBar.right'`, payload =
 *    StatusbarItem) — plugins add theirs through the identical call.
 */

import { useStore } from '@nanostores/react'
import { useQuery } from '@tanstack/react-query'
import { atom, computed } from 'nanostores'
import { type CSSProperties, useMemo, useRef } from 'react'

import { WORK_RAIL_MAX_WIDTH, WORK_RAIL_MIN_WIDTH } from '@/app/chat/right-rail'
import { RightSidebarPane } from '@/app/right-sidebar'
import { ReviewPane } from '@/app/right-sidebar/review'
import type { GroupSetter } from '@/app/shell/group-setter'
import type { StatusbarItem } from '@/app/shell/statusbar-controls'
import { TITLEBAR_HEIGHT } from '@/app/shell/titlebar'
import type { TitlebarTool } from '@/app/shell/titlebar-controls'
import { prepareTreePaneRemovalFocus } from '@/components/pane-shell/tree/store'
import { DecodeText } from '@/components/ui/decode-text'
import { ContribBoundary } from '@/contrib/react/boundary'
import { useContributions } from '@/contrib/react/use-contributions'
import { registry } from '@/contrib/registry'
import { getLogs } from '@/hermes'
import { translateNow } from '@/i18n'
import { normalizeOrLocalPreviewTarget } from '@/lib/local-preview'
import { cn } from '@/lib/utils'
import { $filePreviewTarget, $previewTarget, setCurrentSessionPreviewTarget } from '@/store/preview'
import { $currentCwd } from '@/store/session'

import { requestComposerFocus } from '../chat/composer/focus'
import { LoopPanel, loopPanelStateForWorkflow, loopWorkflowPaneTitle } from '../chat/loop-panel'
import { paneMirror } from '../chat/pane-mirror'
import { ChatPreviewRail } from '../chat/right-rail'
import type { LoopPanelController } from '../chat/use-loop-panel-controller'

// ---------------------------------------------------------------------------
// Logs — live agent-log tail. OPTIONAL chrome: not in any default layout,
// hidden until the ⌘K "Toggle logs" command opens it ($logsOpen).
// ---------------------------------------------------------------------------

export function LogsPane() {
  const { data, error } = useQuery({
    queryKey: ['contrib-logs-tail'],
    queryFn: () => getLogs({ lines: 300 }),
    refetchInterval: 5000
  })

  if (error) {
    return <div className="p-3 text-xs text-(--ui-text-quaternary)">log unavailable: {String(error)}</div>
  }

  if (!data) {
    return (
      <div className="grid h-full place-items-center">
        <DecodeText className="text-(--ui-text-quaternary)" cursor prefix={1} text="LOGS" />
      </div>
    )
  }

  // No chrome of its own — the zone header (when the user summons it) is the
  // pane's only label. Just the tail.
  return (
    <pre className="h-full min-h-0 overflow-auto whitespace-pre-wrap break-words p-2.5 font-mono text-[0.66rem] leading-relaxed text-(--ui-text-secondary)">
      {data.lines.join('\n')}
    </pre>
  )
}

// ---------------------------------------------------------------------------
// Preview — the real rail, fed by the files pane
// ---------------------------------------------------------------------------

/** Preview-server restart handler, provided by the wiring (usePreviewRouting).
 *  Atom-bridged: this module can't import contrib-wiring (it imports us). */
export const $restartPreviewServer = atom<((url: string, context?: string) => Promise<string>) | null>(null)

/** Loop controller owned by contrib wiring and consumed by the independently
 * rendered layout-tree pane. The atom breaks the wiring↔pane import cycle. */
export const $loopPanelController = atom<LoopPanelController | null>(null)

const LOOP_WORKFLOW_PANE_PREFIX = 'loop-workflow'

interface LoopWorkflowPaneDescriptor {
  key: string
  workflowId: null | string
}

function loopWorkflowPaneKey(canvasScopeKey: string, workflowId: string): string {
  return `${encodeURIComponent(canvasScopeKey)}:${encodeURIComponent(workflowId)}`
}

export function loopWorkflowPaneId(canvasScopeKey: string, workflowId: string): string {
  return `${LOOP_WORKFLOW_PANE_PREFIX}:${loopWorkflowPaneKey(canvasScopeKey, workflowId)}`
}

export function loopNewWorkflowPaneId(canvasScopeKey: string): string {
  return loopWorkflowPaneId(canvasScopeKey, '')
}

const $loopWorkflowPanes = computed($loopPanelController, loop => {
  if (!loop?.open || loop.hidden) {
    return []
  }

  const workflows = (loop.workflowIds || []).map(workflowId => ({
    key: loopWorkflowPaneKey(loop.workflowPaneScopeKey, workflowId),
    workflowId
  }))

  return workflows.length
    ? workflows
    : [
        {
          key: loopWorkflowPaneKey(loop.workflowPaneScopeKey, ''),
          workflowId: null
        }
      ]
})

function loopWorkflowPaneDescriptor(key: string): LoopWorkflowPaneDescriptor | undefined {
  return $loopWorkflowPanes.get().find(pane => pane.key === key)
}

export function LoopWorkflowPane({ workflowId }: { workflowId: null | string }) {
  const loop = useStore($loopPanelController)

  const workflowState = useMemo(
    () => (workflowId ? loopPanelStateForWorkflow(loop?.state, workflowId) : null),
    [loop?.state, workflowId]
  )

  const focusRequestKey = workflowId ? loop?.focusRequestKeysByWorkflow[workflowId] || 0 : loop?.focusRequestKey || 0

  const selectedTaskId =
    workflowId && workflowState
      ? workflowState.rows.some(row => row.taskId === loop?.selectedTaskId)
        ? loop?.selectedTaskId || null
        : null
      : workflowId && loop?.activeWorkflowId === workflowId
        ? loop.selectedTaskId
        : null

  const focusedTaskId =
    workflowId && workflowState
      ? workflowState.rows.some(row => row.taskId === loop?.focusedTaskId)
        ? loop?.focusedTaskId || null
        : null
      : workflowId && loop?.activeWorkflowId === workflowId
        ? loop.focusedTaskId
        : null

  const ownsForegroundDetail = Boolean(selectedTaskId || focusedTaskId)

  const selectionRef = useRef({
    focusRequestKey,
    selectedTaskDetail: ownsForegroundDetail ? loop?.selectedTaskDetail : null,
    selectedTaskDetailError: ownsForegroundDetail ? loop?.selectedTaskDetailError : null,
    selectedTaskId
  })

  // The controller has one foreground selection, while every native canvas
  // stays mounted. Update a workflow's snapshot only for an explicit request
  // targeting it (or while its selected detail resolves), so switching peer
  // tabs cannot clear an inactive canvas's local task/artifact navigation.
  if (selectionRef.current.focusRequestKey !== focusRequestKey || ownsForegroundDetail) {
    selectionRef.current = {
      focusRequestKey,
      selectedTaskDetail: ownsForegroundDetail ? loop?.selectedTaskDetail : null,
      selectedTaskDetailError: ownsForegroundDetail ? loop?.selectedTaskDetailError : null,
      selectedTaskId
    }
  }

  if (!loop) {
    return null
  }

  const selection = selectionRef.current

  return (
    <div className="h-full min-h-0 overflow-hidden" data-loop-workflow-id={workflowId || ''}>
      <LoopPanel
        canvasScopeKey={loop.canvasScopeKey}
        embedded
        focusRequestKey={focusRequestKey}
        hidden={loop.hidden}
        onAddTaskComment={loop.onAddTaskComment}
        onCreateTask={loop.onCreateTask}
        onFocusTaskId={loop.onFocusTaskId}
        onHide={() => (workflowId ? loop.onCloseWorkflowId(workflowId) : loop.onHide())}
        onLinkTasks={loop.onLinkTasks}
        onSavePositions={loop.onSavePositions}
        onSelectTaskId={loop.onSelectTaskId}
        onTaskAction={loop.onTaskAction}
        onUnlinkTasks={loop.onUnlinkTasks}
        open={loop.open}
        positions={
          workflowId
            ? (loop.positionsByWorkflow[workflowId] ?? (loop.workflowId === workflowId ? loop.positions : undefined))
            : loop.positions
        }
        selectedTaskDetail={selection.selectedTaskDetail}
        selectedTaskDetailError={selection.selectedTaskDetailError}
        selectedTaskId={selection.selectedTaskId}
        state={workflowState}
        workflowCanvas
        workflowId={workflowId || undefined}
      />
    </div>
  )
}

function closeLoopWorkflowPane(key: string) {
  const descriptor = loopWorkflowPaneDescriptor(key)
  const loop = $loopPanelController.get()

  if (!descriptor || !loop) {
    return
  }

  if (!descriptor.workflowId) {
    loop.onHide()
    requestComposerFocus()

    return
  }

  if (!loop.workflowIds.includes(descriptor.workflowId)) {
    return
  }

  const closeResult = loop.onCloseWorkflowId(descriptor.workflowId)

  if (closeResult?.closedLast) {
    requestComposerFocus()
  } else if (closeResult?.nextWorkflowId) {
    prepareTreePaneRemovalFocus(
      loopWorkflowPaneId(loop.workflowPaneScopeKey, descriptor.workflowId),
      loopWorkflowPaneId(loop.workflowPaneScopeKey, closeResult.nextWorkflowId)
    )
  }
}

/** Mirror every open workflow into the native layout-tree tab system. */
export const watchLoopWorkflowPanes = paneMirror<LoopWorkflowPaneDescriptor>({
  source: $loopWorkflowPanes,
  activate: key => {
    const descriptor = loopWorkflowPaneDescriptor(key)
    const loop = $loopPanelController.get()

    if (descriptor?.workflowId && loop && loop.activeWorkflowId !== descriptor.workflowId) {
      loop.onActivateWorkflowId(descriptor.workflowId)
    }
  },
  key: pane => pane.key,
  prefix: LOOP_WORKFLOW_PANE_PREFIX,
  anchor: () => 'loop',
  before: () => 'loop',
  close: closeLoopWorkflowPane,
  dir: () => 'center',
  keepAliveWhenInactive: true,
  maxWidth: WORK_RAIL_MAX_WIDTH,
  minWidth: WORK_RAIL_MIN_WIDTH,
  preferredActive: key => {
    const descriptor = loopWorkflowPaneDescriptor(key)
    const loop = $loopPanelController.get()

    return Boolean(descriptor && loop && descriptor.workflowId === loop.activeWorkflowId)
  },
  render: key => {
    const descriptor = loopWorkflowPaneDescriptor(key)

    return descriptor ? <LoopWorkflowPane workflowId={descriptor.workflowId} /> : null
  },
  replacements: (previous, next) => {
    const pending = previous.length === 1 && !previous[0]?.workflowId ? previous[0] : null
    const hydrated = next.length === 1 && next[0]?.workflowId ? next[0] : null

    return pending && hydrated ? [{ from: pending.key, to: hydrated.key }] : []
  },
  title: key => {
    const descriptor = loopWorkflowPaneDescriptor(key)

    return descriptor
      ? descriptor.workflowId
        ? loopWorkflowPaneTitle($loopPanelController.get()?.state, descriptor.workflowId)
        : translateNow('statusStack.newWorkflow')
      : key
  },
  width: 'clamp(24rem, 36vw, 34rem)'
})

export function PreviewRailPane() {
  const previewTarget = useStore($previewTarget)
  const fileTarget = useStore($filePreviewTarget)
  const restartPreviewServer = useStore($restartPreviewServer)

  if (!previewTarget && !fileTarget) {
    return (
      <div className="grid h-full place-items-center px-4 text-center">
        <div className="flex flex-col items-center gap-1.5">
          <DecodeText className="text-(--ui-text-quaternary)" prefix={1} text="PREVIEW" />
          <span className="text-[0.68rem] text-(--ui-text-quaternary)">click a file in the files pane</span>
        </div>
      </div>
    )
  }

  return (
    // The contrib layout zeroes --titlebar-height (content sits BELOW the
    // titlebar, so the real components' clearance padding must collapse) —
    // but the rail SIZES its per-file tab strip with that var. Restore the
    // real value for this subtree so the tabs always render at full height.
    <div
      className={cn(ZONE_CONTENT, 'min-h-0 w-full overflow-hidden [&>aside]:pt-0')}
      style={{ '--titlebar-height': `${TITLEBAR_HEIGHT}px` } as CSSProperties}
    >
      <ChatPreviewRail
        onRestartServer={restartPreviewServer ?? undefined}
        setTitlebarToolGroup={setTitlebarToolGroup}
      />
    </div>
  )
}

/** Open a file from the tree in the real preview pipeline. */
function previewFile(path: string) {
  void normalizeOrLocalPreviewTarget(path, $currentCwd.get() || undefined)
    .then(target => {
      if (target) {
        setCurrentSessionPreviewTarget(target, 'file-browser', path)
      }
    })
    .catch(() => undefined)
}

// Layout fit for wrapped asides. Edge chrome (borders/shadows) is neutralized
// GLOBALLY by the tree's seam invariant (see LayoutTreeRoot) — only sizing
// and titlebar clearance are per-wrapper concerns.
const ZONE_CONTENT = 'h-full [&>aside]:h-full [&>aside]:w-full [&>aside]:pt-0'

export function FilesPane() {
  return (
    <div className={ZONE_CONTENT}>
      <RightSidebarPane onActivateFile={previewFile} onActivateFolder={previewFile} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Review — the real git diff pane (⌘G / $reviewOpen)
// ---------------------------------------------------------------------------

export function ReviewPaneContent() {
  const cwd = useStore($currentCwd)

  // Keyed by cwd like DesktopController so switching projects rebuilds the
  // diff state instead of showing the previous repo's files.
  return (
    <div className={cn(ZONE_CONTENT, 'flex min-h-0 flex-col [&>aside]:min-h-0 [&>aside]:flex-1')}>
      <ReviewPane key={cwd || 'no-cwd'} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Statusbar composability: plugins contribute DATA items into
// `statusBar.left` / `statusBar.right`; the wiring feeds them into the REAL
// useStatusbarItems as extraLeftItems/extraRightItems. No core filler here —
// the real statusbar owns the core items (model pill, terminal toggle, …).
// ---------------------------------------------------------------------------

/** Collect statusbar contributions for one side. A `render()` contribution
 *  becomes a render-item (arbitrary stateful node); otherwise the declarative
 *  `data` payload is the StatusbarItem. */
export function useStatusbarContributions(side: 'left' | 'right'): StatusbarItem[] {
  const items = useContributions(`statusBar.${side}`)

  return items
    .map(c =>
      c.render
        ? ({
            id: c.id,
            render: () => (
              <ContribBoundary id={c.id} variant="chip">
                {c.render!()}
              </ContribBoundary>
            )
          } satisfies StatusbarItem)
        : (c.data as StatusbarItem)
    )
    .filter(Boolean)
}

/** Collect TitlebarTool data contributions for one side of the titlebar. */
export function useTitlebarToolContributions(side: 'left' | 'right'): TitlebarTool[] {
  const items = useContributions(`titleBar.tools.${side}`)

  return items.map(c => c.data as TitlebarTool).filter(Boolean)
}

/**
 * Bridge a page's `GroupSetter` extension point (SkillsView, MessagingView,
 * ChatPreviewRail, …) into the registry: each call replaces the group's items
 * as DATA contributions in `<prefix>.<side>`, so page-owned items flow through
 * the same pipe plugins use. Setting an empty list clears the group.
 */
export function registryGroupSetter<T>(prefix: string): GroupSetter<T> {
  const disposers = new Map<string, () => void>()

  return (id, items, side = 'right') => {
    const key = `${side}:${id}`

    disposers.get(key)?.()
    disposers.set(
      key,
      registry.registerMany(
        items.map((item, i) => ({
          id: `${id}-${i}`,
          area: `${prefix}.${side}`,
          source: 'core',
          order: 100 + i,
          data: item as object
        }))
      )
    )
  }
}

/** The app's page-facing setters — the same `GroupSetter` shape pages already
 *  take as props, backed by the registry instead of component state. */
export const setStatusbarItemGroup = registryGroupSetter<StatusbarItem>('statusBar')
export const setTitlebarToolGroup = registryGroupSetter<TitlebarTool>('titleBar.tools')
