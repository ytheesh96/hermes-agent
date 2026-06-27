---
sidebar_position: 13
title: "Desktop Chat App"
description: "Hermes desktop chat internals — Electron surface, TUI gateway RPC, and slash command routing"
---

# Desktop Chat App

The desktop app in `apps/desktop/` is a separate chat surface from both the
classic CLI and the dashboard's embedded TUI. It is an Electron + React +
nanostore renderer built on `@assistant-ui/react` that talks to the
`tui_gateway` backend over JSON-RPC via `requestGateway(method, params)`.

It does **not** embed `hermes --tui`: it owns its own composer, transcript, and
slash-command pipeline.

## Relationship to the TUI and dashboard

- Classic CLI: prompt-toolkit terminal UI.
- TUI: Ink app launched by `hermes --tui`.
- Dashboard chat: browser embeds the real TUI through a PTY bridge; do not
  rebuild the primary chat transcript/composer in React there.
- Desktop app: Electron renderer with its own React transcript/composer talking
  to `tui_gateway` JSON-RPC.

If you find yourself rebuilding the desktop transcript in the dashboard, stop
and extend the TUI/dashboard PTY surface instead. If you find yourself embedding
`hermes --tui` inside the desktop app, stop and extend the desktop renderer.

## Slash command pipeline

The backend already provides the command data the desktop needs:

- `tui_gateway/server.py` `commands.catalog` returns the empty-query command
  catalog.
- `complete.slash` returns typed-query completions.
- Both include built-in commands, user `quick_commands`, and skill-derived
  commands from `scan_skill_commands()` / `get_skill_commands()`.

The renderer curates that backend data in
`apps/desktop/src/lib/desktop-slash-commands.ts`:

- `DESKTOP_COMMANDS` is the curated built-in command set shown in the palette.
- Block lists hide terminal-only, messaging-only, picker-owned, settings-owned,
  or advanced commands that should not clutter the desktop popover.
- `isDesktopSlashCommand(name)` gates execution. It returns true for curated
  built-ins and for non-built-in extension commands, so typed skill and quick
  commands run.
- `isDesktopSlashSuggestion(name)` gates discovery/completion. Both completion
  paths in `app/chat/composer/hooks/use-slash-completions.ts` use it, as does
  `filterDesktopCommandsCatalog`.
- `isDesktopSlashExtensionCommand(name)` is true for commands that are not known
  Hermes built-ins. Keep this flowing into both suggestion and catalog-filter
  paths so skill commands and `quick_commands` stay visible.

The key rule: desktop slash palette curation hides noise; it must not hide
user-activated extensions. Skill commands and `quick_commands` belong in
completions and execution.

## Dispatch path

`app/session/hooks/use-prompt-actions.ts` owns `runSlash`:

1. Desktop-owned built-ins such as `/skin`, `/help`, and `/new` are handled
   locally or via `commands.catalog`.
2. Other commands go to `slash.exec`.
3. If needed, dispatch falls back to `command.dispatch`, where the gateway
   resolves skills, aliases, and exec directives.
4. A skill command resolves to `{type: "skill", message}` and is submitted as a
   normal prompt.

## Verification

For slash command curation changes, run the desktop slash tests from the repo
root (the desktop package resolves dependencies from the root workspace install):

```bash
npm run test:ui --workspace apps/desktop -- src/lib/desktop-slash-commands.test.ts
```

If the change touches broader desktop UI behavior, also run the relevant
`apps/desktop` build/typecheck path documented in the desktop package scripts.
