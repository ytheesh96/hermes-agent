import { type ReactNode } from 'react'

import { Codicon } from '@/components/ui/codicon'
import { GlyphSpinner } from '@/components/ui/glyph-spinner'
import { AlertCircle } from '@/lib/icons'
import { cn } from '@/lib/utils'

export type StatusIndicatorKind = 'active' | 'attention' | 'done' | 'failed' | 'pending' | 'triage' | 'unknown'

interface StatusIndicatorProps {
  ariaLabel?: string
  className?: string
  kind: StatusIndicatorKind
}

function statusGlyph(kind: StatusIndicatorKind, ariaLabel?: string): ReactNode {
  switch (kind) {
    case 'triage':
      return (
        <span
          aria-hidden="true"
          className="box-border size-[0.7rem] rounded-full border border-dashed border-muted-foreground/60"
        />
      )
    case 'pending':
      return <Codicon aria-hidden="true" className="text-muted-foreground/40" name="pass-filled" size="0.8rem" />
    case 'active':
      return (
        <GlyphSpinner
          ariaLabel={ariaLabel || 'Running'}
          className="text-[0.9rem] leading-none text-muted-foreground/80"
          spinner="braille"
        />
      )
    case 'done':
      return <Codicon aria-hidden="true" className="text-emerald-500/80" name="pass-filled" size="0.8rem" />
    case 'failed':
      return <Codicon aria-hidden="true" className="size-3.5 text-destructive/80" name="circle-slash" />
    case 'attention':
      return <AlertCircle aria-hidden="true" className="size-3.5 text-amber-500/85" />
    case 'unknown':
    default:
      return <Codicon aria-hidden="true" className="size-3.5 text-muted-foreground/40" name="question" />
  }
}

export function StatusIndicator({ ariaLabel, className, kind }: StatusIndicatorProps) {
  return (
    <span
      aria-label={ariaLabel}
      className={cn('grid size-3.5 shrink-0 place-items-center overflow-hidden', className)}
      role={ariaLabel ? 'img' : undefined}
    >
      {statusGlyph(kind, ariaLabel)}
    </span>
  )
}
