# Hermes Loop

Hermes Loop is built on top of [Nous Research's Hermes Agent](https://github.com/NousResearch/hermes-agent).
It keeps the upstream agent framework intact while exploring how long-running
AI work can feel like a visible, resumable branch: planned in a task graph,
executed by durable workers, reviewed through explicit handoffs, and resumed
from the original conversation.

## Demo

https://github.com/user-attachments/assets/48ea333a-3fe8-4a4a-b2e5-66af5b055fee

## Installation

Hermes Loop uses the upstream Hermes Agent installers: `scripts/install.sh` on
macOS/Linux and `scripts/install.ps1` in Windows PowerShell.

## What this fork adds

- **Durable Loop/Kanban task engine**: Loop mode routes work into persistent
  Kanban tasks with dependencies, child rows, blockers, review lanes, and
  resumable worker context instead of process-local background jobs.
- **Desktop Loop panel and task graph**: the Electron desktop UI has a Loop work
  rail, overview graph, selected-node actions, composer status rows, and
  session-linked Loop activity so users can watch background work like a branch
  graph.
- **Long-running delegation**: `delegate_task(mode="loop")` creates durable work
  that survives the parent turn and can re-enter the origin session when
  complete, while ordinary subagents remain lightweight for short parallel
  tasks.
- **External worker orchestration**: Kanban workers can be dispatched across
  profiles/workspaces with profile-aware session context, task dependencies,
  and worker lifecycle proof packets.
- **Review, handoff, and proof-packet flow**: implementation workers can request
  QA or orchestrator review on the same task row, attach structured metadata,
  and leave auditable result packets for downstream agents.
- **Session lineage and resumption fixes**: Loop rows prefer stable session keys
  over rotating runtime session IDs so Desktop/TUI-owned work remains attached
  to the user's visible conversation.
