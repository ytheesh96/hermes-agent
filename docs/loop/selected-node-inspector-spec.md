# Selected-node inspector + action bar spec

> Loop graph-first UX
>
> Status: draft for implementation

## Goal

Make the selected-node inspector the main place where a user understands a node, asks about it in chat, and performs safe graph actions without implying automatic dispatch.

## Non-goals

- No new execution semantics for child creation, alternatives, blocking, or archiving.
- No silent dispatch, auto-start, or hidden background mutation.
- No redesign of the graph itself; this spec only covers the selected-node inspector/action bar.

## Reuse existing patterns

Prefer the existing Loop panel shell and the current task-details styling:

- reuse the `LoopTaskDetails` card structure
- reuse the current button density and icon/button treatment from `LoopTaskActions`
- reuse `DetailSection` / `EmptyDetail` for supporting content and empty states

If a capability is missing, show a disabled or preview affordance. Do not fake execution.

## Placement and layout

The selected-node inspector lives in the right rail, directly beneath the tab/titlebar area in the Loop panel.

Recommended vertical order:

1. Node header
2. Action bar
3. Short summary / description preview
4. Related graph context
5. Audit / status notes

The action bar should be visible without scrolling on an average inspector height.

## Node header

Header content, left to right:

- status chip
- node title
- optional assignee / run state line if present

Copy rules:

- Title is the primary text.
- Keep task ids available through accessible labels, test ids, relationship/debug surfaces, or explicit source/detail views rather than as header chrome.
- Status should be readable before any action is taken.

## Action ordering

Use this stable left-to-right order:

1. Open details
2. Ask in chat
3. Add child
4. Add alternative
5. Block / Unblock
6. Archive

If the rail is too narrow, wrap into two lines but keep the order unchanged.

## Button labels and intent

### 1) Open details

Purpose: open the full task detail view for the selected node.

Copy:
- Label: `Open details`
- Tooltip: `Open the full inspector for this node`

State:
- Available when the selected node exists.
- If details are already open, keep the button available; do not change the label.

### 2) Ask in chat

Purpose: create a chat draft that references the selected node and its context.

Required label:
- `Ask in chat`

Copy rules:
- Never shorten the label.
- Do not rename it to “Ask Hermes” in the UI label.
- The helper text / tooltip may explain that it inserts context into chat.

Suggested tooltip:
- `Insert this node into chat with a prefilled question or prompt`

State:
- Available whenever the node exists.
- If chat is unavailable, disable it with a reason.

### 3) Add child

Purpose: create a follow-up child row under the selected node.

Copy:
- Label: `Add child`
- Confirmation CTA: `Create child row`

Behavior:
- Opens a gated composer or follow-up row sheet.
- Creates an auditable draft first.
- Must not imply the child is dispatched or started automatically.

Required safety copy in the sheet:
- `This creates a follow-up row. It does not start execution.`

### 4) Add alternative

Purpose: create a sibling/alternate option row.

Copy:
- Label: `Add alternative`
- Confirmation CTA: `Create alternative row`

Behavior:
- Opens the same follow-up row pattern as Add child, but marks the relation as alternative/sibling.
- Must clearly state that the option is proposed, not executed.

Required safety copy:
- `This creates a proposed alternative. It does not dispatch work.`

### 5) Block / Unblock

Purpose: change the node’s status with an auditable reason.

Copy:
- When unblocked: label `Unblock`
- When not blocked: label `Block`
- Confirmation CTA: `Save status change`

Behavior:
- Always gated behind a confirm sheet or inline reason entry.
- The UI must ask for a reason when moving into blocked state.
- The result should be recorded as a status change, not a hidden side effect.

Required safety copy:
- `Status changes are audited.`

### 6) Archive

Purpose: move the node out of the active graph.

Copy:
- Label: `Archive`
- Confirmation CTA: `Archive node`

Behavior:
- Gated confirmation.
- If the node has children or downstream rows, show the count before confirming.
- Use clear, reversible wording where possible.

Required safety copy:
- `Archived nodes remain auditable and can be restored by a later action.`

## Empty / no-selection behavior

When no node is selected, the right rail should not look broken or blank.

Show an empty state card with:

- Title: `No node selected`
- Body: `Click a node in the graph to inspect its details and actions.`
- Optional helper line: `You can also open a node from chat or search.`

Do not show action buttons in this state.

## Selected-but-unavailable behavior

If the selected node disappears after a refresh or becomes unreachable from the latest source:

- Keep the selection sticky.
- Show the selected node id or title if known.
- Show the message: `Selected node unavailable`
- Body copy: `This node is missing from the latest Loop source. It may have been archived, deleted, or refreshed out of this session lineage.`

Also provide one recovery action:
- `Select another node`
- or `Close inspector`

## Disabled states

Use disabled states when the action exists conceptually but cannot be performed right now.

Examples:

- no backend capability for the action on this node
- selected node lacks required context
- user permissions or routing state prevent the mutation
- chat panel is unavailable

Disabled buttons must:

- remain in the normal order
- keep their label visible
- explain why they are disabled in tooltip/help text
- never look like they will succeed if they cannot

Suggested disabled copy patterns:

- `Not available for this node`
- `Requires a selected node with loaded details`
- `Chat panel is closed`
- `This action is not yet wired for the current backend`

## Preview states

Use a preview affordance when the product wants to advertise an upcoming capability without pretending it is already live.

Preview behavior:

- render the button with a small `Preview` badge or tag
- clicking opens a read-only explainer panel, not a mutation
- the panel should describe the intended behavior and the follow-up-row pattern

Preview copy example:

- `Preview: this will create a proposed child row, then ask for review before anything runs.`

## Gated / auditable mutation states

Actions that mutate state must be visibly gated and auditable.

Minimum gate requirements:

- show a confirmation step for Add child, Add alternative, Block, Unblock, Archive
- include a short reason field for Block and Unblock when relevant
- show a summary of what will happen before confirmation
- create an audit event / row that can be read back later

The UI should never say or imply:

- `started`
- `dispatched`
- `running now`
- `will execute immediately`

unless the backend truly guarantees that behavior and the product intends it.

## Suggested microcopy

- Empty state title: `No node selected`
- Inspector unavailable: `Selected node unavailable`
- Details button: `Open details`
- Chat button: `Ask in chat`
- Child button: `Add child`
- Alternative button: `Add alternative`
- Block button: `Block`
- Unblock button: `Unblock`
- Archive button: `Archive`
- Child confirmation: `Create child row`
- Alternative confirmation: `Create alternative row`
- Status confirmation: `Save status change`
- Archive confirmation: `Archive node`

## Interaction notes

- Selection should persist while the inspector loads details.
- If details are stale, keep the current selection and surface the stale/unavailable message instead of jumping to a different node.
- The action bar should not re-order itself based on status; only labels and availability should change.
- Keyboard focus should move into the selected inspector when a node is opened from the graph.

## Accessibility notes

- Every icon button needs a text label or accessible name.
- Disabled buttons still need an explanation accessible via tooltip or helper text.
- Status changes and archive confirmations need clear dialog titles.
- The empty state must be announced as informational, not as an error.

## Acceptance criteria

- [ ] No-selection state shows an explicit empty card instead of a blank rail.
- [ ] The inspector action order is stable and matches the specified order.
- [ ] `Ask in chat` is the preferred conversational label and appears exactly as written.
- [ ] Open details, Ask in chat, Add child, Add alternative, Block/Unblock, and Archive are all represented.
- [ ] Mutating actions are gated and audited; they do not imply automatic dispatch.
- [ ] Missing backend capability is represented with disabled or preview affordances, not fake success behavior.
- [ ] Selected-node-unavailable state is sticky and recoverable.
- [ ] The copy makes the difference between available, disabled, preview, and gated mutation states obvious.

## Implementation note for peacock

Start by extending the current Loop task-details shell rather than inventing a new panel. The smallest implementation path is usually:

1. add the new action bar copy/state model
2. wire disabled/preview/gated states
3. add tests for the state matrix and microcopy
4. keep the current `LoopTaskActions` visual density unless a new layout is needed
