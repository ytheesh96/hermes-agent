# Choice-group graph visual treatment

## Goal
Add a first-class, low-noise visual treatment for Loop decision branches in the existing Hermes Desktop graph so users can immediately see that a set of alternative tasks represents a single choose-one decision.

This is a targeted graph treatment, not a dashboard redesign.

## Scope
Trigger this treatment only for rows that participate in the same `decision_group_id`.

Use existing graph conventions where possible:
- status dot from the current row state system
- dashed treatment for unconfirmed options
- muted/filled styling for terminal or lower-priority states
- keep current node size, placement, zoom, and hover behavior

## When the treatment appears
Render choice-group chrome when at least one visible row has:
- `branch_kind = alternative`
- `decision_group_id` present

Render per-row choice state when `selection_state` is present, even if grouping metadata is incomplete.

If any of these fields are absent, fall back gracefully:
- no `decision_group_id` → no shared group container or label
- no `branch_kind` → do not infer alternative semantics; keep current node styling
- no `selection_state` → show neutral candidate styling for grouped alternatives

## Visual structure
For each visible `decision_group_id`:

1. Keep the existing node layout unchanged.
2. Add a lightweight shared group affordance that visually ties siblings together.
   - Prefer a thin bracket/rail or a soft enclosing band behind the sibling stack.
   - Place a compact label at the group’s leading edge: `Choose one`.
3. Add a small state pill on each option node.
   - candidate → `Candidate`
   - recommended → `Recommended`
   - chosen → `Chosen`
   - rejected → `Rejected`

Do not add a large card or panel around the group. The graph should still read as the same graph.

## State treatment
Map choice states to distinct visual cues using color + shape, not color alone.

### Candidate
- Default alternative styling
- Dashed outline or dashed connector treatment, matching current tentative edge convention
- Neutral text and border
- State pill: `Candidate`

### Recommended
- Same base styling as candidate
- Add a warm accent marker, such as an amber star/dot/badge
- Keep it visually stronger than plain candidate but weaker than chosen
- State pill: `Recommended`

### Chosen
- Strongest emphasis
- Solid border using the primary/accent token already used for selected graph nodes
- Solid connectors; no dashed tentative treatment
- Optional checkmark icon in the state pill
- State pill: `Chosen`

### Rejected
- Keep visible for traceability, but de-emphasize
- Lower opacity and/or muted border/background
- Use a shape cue such as a slash/cross icon in the state pill
- State pill: `Rejected`

## Copy and tooltips
Keep copy short and operational.

Recommended labels:
- group label: `Choose one`
- tooltip on group rail: `One option in this group should be selected`
- node tooltip / aria text should include the choice state and group membership, for example:
  - `Candidate option in decision group Alpha`
  - `Recommended option in decision group Alpha`
  - `Chosen option in decision group Alpha`
  - `Rejected option in decision group Alpha`

If only one option in a group is visible, the group label may still appear if `decision_group_id` is known, but avoid implying more siblings than the data supports.

## Accessibility
Use color plus shape plus text.

Requirements:
- every state must be legible in both light and dark themes
- state must be present in the accessible name or tooltip text
- focus state must remain visible on top of group chrome
- rejected and candidate must remain distinguishable without relying on hue alone
- chosen must be the only state that reads as selected/active

Suggested cues:
- candidate: dashed edge/outline
- recommended: star or dot badge
- chosen: check icon + solid outline
- rejected: slash icon + muted opacity

## Failure / partial-data behavior
Do not fabricate semantics.

If data is incomplete:
- `decision_group_id` missing: render a normal row
- `selection_state` missing: treat as candidate if it is still an alternative row
- mixed visible rows within the same group missing some state values: render the group shell, but leave unknown rows neutral rather than guessing chosen/rejected
- non-alternative rows with the same `decision_group_id` should not be force-styled as alternatives unless the row itself says `branch_kind = alternative`

## Desktop implementation notes
The implementation should be local to the existing graph component and row-state derivation, not a separate product surface.

Likely touch points:
- `apps/desktop/src/app/chat/loop-panel.tsx`
- `apps/desktop/src/app/chat/loop-panel.test.tsx`
- `apps/desktop/src/app/chat/loop-state.ts` only if state normalization needs a small helper

Prefer reusing current graph layout and edge drawing logic. The only new behavior should be the group affordance and per-state styling.

## Acceptance notes
A desktop implementation is acceptable when:

1. Two or more visible `alternative` rows with the same `decision_group_id` render as a clearly grouped choose-one set.
2. Candidate, recommended, chosen, and rejected are visually distinct using both color and shape/text.
3. The chosen row is unmistakably the active selection; unchosen siblings remain visible but de-emphasized.
4. Rows with missing metadata degrade to the current graph appearance instead of breaking layout.
5. Existing non-decision graph rows are unchanged.
6. Keyboard and screen-reader users can identify group membership and choice state from the node’s accessible text.
7. Tests cover grouped alternatives, chosen vs candidate vs rejected rendering, and the fallback behavior when metadata is absent.
