# Live Loop Graph Compilation

## Goal

Let the foreground agent build a durable task graph using only brief titles and
dependencies. Creating a node submits it immediately; there is no separate
graph-level Submit step. The foreground may keep extending or rewiring pending
work as results arrive.

The existing Kanban auto-decomposer owns detailed specifications, assignee
routing, acceptance criteria, and optional fan-out. It runs just in time, only
after a skeleton's dependencies are complete.

## Architecture

- SQLite is authoritative for tasks, links, state, events, and graph ownership.
- Desktop is a live view and editor over that durable graph.
- `delegate_task(mode="loop", decompose=true, tasks=[...])` is the foreground
  graph-construction contract. Each row needs only an `id`/`client_id`, a brief
  `title`/`goal`, and optional `depends_on` aliases. Aliases are local to one
  fragment; later fragments reference existing nodes by durable task id.
- A dependency-ready skeleton enters `triage` with
  `needs_specification=true`; a blocked skeleton waits in `todo`.
- The auto-decomposer specifies a skeleton in place or expands it into a child
  DAG, then clears `needs_specification` atomically.
- Running and completed nodes are immutable history. Topology edits are allowed
  only while the affected child is pending.

## Foreground contract

```python
delegate_task(
    mode="loop",
    decompose=True,
    root_task_id="t_existing_root",
    tasks=[
        {"id": "research", "title": "Research current behavior"},
        {
            "id": "build",
            "title": "Implement the selected approach",
            "depends_on": ["research"],
        },
        {
            "id": "verify",
            "title": "Verify end to end",
            "depends_on": ["build"],
        },
    ],
)
```

The foreground owns topology and timing: it decides which graph fragment to
create next and can add new pending work after observing results. It does not
choose worker profiles or write worker-ready task bodies.

Legacy single-goal Loop calls with `decompose=true` retain their previous
direct-decomposition and goal-mode behavior. Non-decomposed Loop delegation and
ordinary manually created Kanban cards are unchanged.

## Required invariants

1. Each submitted graph fragment validates and commits tasks plus links in one
   transaction; invalid aliases, missing dependencies, cycles, or size-limit
   violations leave no partial rows. An exact retry is idempotent, while a later
   fragment may reuse the same local aliases without reusing old nodes.
2. `needs_specification=true` tasks cannot be claimed, including after a stale
   or manual status write.
3. A skeleton reaches specification only after all parents are done or archived.
4. If shell `B` expands and `A -> B`, every generated entry child inherits `A`;
   generated exits link back to `B`; existing `B -> C` edges remain attached.
5. Completed parent summaries and immediate graph neighbors are the bounded
   context supplied to just-in-time specification.
6. Foreground edits and decomposer writes use revision/state checks so stale
   decomposition cannot overwrite newer topology or titles.
7. Specification failures remain visible and retry with backoff instead of
   spending an LLM call every dispatcher tick.
8. Link/unlink/archive controls cannot mutate running or terminal graph nodes.
9. Explicit Loop roots become unassigned `ready` rows after their sink nodes
   finish. The foreground either extends the graph (which returns the root to
   `todo`) or completes the root when the objective is satisfied; no worker can
   race that decision.
10. `loop.max_graph_nodes` bounds durable fragment size independently of
    `delegation.max_concurrent_children`.

## Desktop behavior

- The first empty-canvas action creates the scheduled Loop root and immediately
  asks the foreground session to triage the request. The root is explicitly
  unassigned so only the foreground decides whether to extend or finalize it.
- Adding a canvas node creates its title and initial incoming/outgoing edges in
  one request. There is no assignee picker and no follow-up link race.
- Nodes show plain-language phases: Planning, Specifying, Waiting for
  dependencies, Running, Blocked, and Complete.
- The Desktop checks the backend live-graph capability before using the atomic
  node contract, preventing older backends from silently creating standalone
  roots from unknown request fields.

## Verification targets

- Atomic chain, fan-out/fan-in, rollback, cycle, external-parent, idempotency,
  root wake-up, configured graph-limit, and claim-guard tests.
- Specification/decomposition boundary, failure backoff, and stale-revision
  tests.
- Scoped link mutation races and running/completed immutability tests.
- Desktop creation, capability fallback, pending-only controls, live phases,
  and absence of a graph Submit action.
- Focused Python tests, Desktop Vitest, TypeScript typecheck, Ruff, compilation,
  and `git diff --check`.
