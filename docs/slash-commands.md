# Slash commands in the full-screen HUD

How `/command`, `!shell` and `$ python` lines typed into the prompt of `/hud full` reach omp, what was verified, and what the feature depends on. Turkish: [slash-commands.tr.md](slash-commands.tr.md). Verified with **omp 18.8.9** only.

## Why a detour is needed

omp has no API that runs a command from an extension: neither `ctx` nor `pi` offers one (`pi.getCommands()` only lists extension, prompt and skill commands, not omp's built-ins). `pi.sendUserMessage(text)` submits plain text **without** expanding commands or templates, so a `/plan` sent that way goes to the model as the text `/plan`. The only path that runs everything the way typing does is omp's own editor, so the HUD uses it.

## The route (`src/slash.ts`, `runLine` in `index.ts`)

1. **Classify the line.** `/hud ...` stays local. Other `/x`, `!x` and `$ x` lines are omp's; anything else is a message for the agent (`Enter` / `Alt+Enter` as before, `makeBridge.send` is untouched).
2. **Refuse unknown commands.** omp sends an unknown `/xyz` to the model as plain text. The HUD asks omp's autocomplete provider whether the name exists (aliases included) and refuses otherwise. When no provider could be captured the check is skipped (the line is passed on).
3. **Save the draft** of omp's editor (`ctx.ui.getEditorText()`).
4. **Hide the overlay** with the handle from `ctx.ui.custom(..., { onHandle })`: `handle.setHidden(true)` returns the focus to omp's editor. This is needed for every command: a dialog opened by an extension (`ctx.ui.select`, `/settings`) is mounted under a visible full-screen overlay without focus and cannot be seen.
5. **Find the editor.** The focused component when it has `submit`, `setText` and `getText` functions; otherwise a walk through `tui.children` (depth 8, cycle-safe). A `disableSubmit` editor is not used.
6. **Submit.** `ctx.ui.setEditorText(line)`, then `editor.submit()`: the same path as the Enter key (`input` event with `source: "interactive"` included).
7. **Wait for the focus** (poll every 50 ms: `tui.getFocused() === editor && !tui.hasOverlay()`). If a viewer or a dialog took the focus, the HUD returns by itself once the focus is back. If the focus never left within 200 ms the command only printed into the transcript or the status line: the HUD stays hidden, the status line says `HUD: press any key to return` and the first key (not focus or mouse reports) is swallowed with `ctx.ui.onTerminalInput` and shows the HUD. A dialog that opens late cancels that pause and is waited for as usual. If no key listener can be installed the HUD returns at once.
8. **Always come back.** A `finally` puts the draft back (unless the command filled the editor itself) and calls `setHidden(false)`, on every path: unknown editor, disabled submit, an exception, a command that switched the session (`/new`). The only exception is a HUD that was closed meanwhile (`/exit`).

A command already running refuses a second one (`The previous command is still running`). In `/hud demo full` nothing is sent.

## The palette

On `/` at the start of the prompt and on an `@` mention at the cursor the HUD asks the **captured base autocomplete provider** (`ctx.ui.addAutocompleteProvider`, registered once per process, a pass-through that only remembers the base omp hands over) with `getSuggestions([line], 0, cursor)` and shows at most 8 items: name (with `/` for commands), argument hint, description. `↑` / `↓` select, `Tab` applies through the provider's `applyCompletion`, `Enter` applies unless the text would not change (then it runs), `Esc` closes. One query per keystroke; an answer to an older text is dropped. omp's items are cleaned of control characters and ANSI before drawing.

## What was verified (omp 18.8.9, fake local provider, no model request)

Terminal tests with a pty (`Bun.spawn({ terminal })` + `@xterm/headless`), `omp --no-session --no-skills --no-rules --no-lsp --no-extensions -e <index.ts> -e <fake provider>`; the fake provider counts every model call.

- `/to` lists `tools` first with its live description; `/session ` offers `info`, `delete`, `pin`; `@co` lists files; `Esc` closes the list and keeps the text; a narrow 80x24 screen works.
- `/tools` (viewer), `/dlg` (an extension `select`): the HUD hides, the dialog is visible and focused, `Esc` closes it and the HUD returns by itself.
- `/ping x` (extension command, `notify`), `!echo hi` (output `hi`), `/new`: the HUD stays hidden with `HUD: press any key to return`; the key is swallowed and the HUD returns; commands typed afterwards work.
- While the agent was busy (a 9 s fake turn) `/ping` and `/tools` ran at once and the HUD came back.
- `/xyz` is refused and stays in the prompt; `!echo hi` and every command above made **zero** model calls. The only model call of the run was the plain message sent for comparison.
- A draft in omp's editor survived all of it; `/hud doctor` reports `editor yes`, `autocomplete provider yes` and the last command.

Not tried (they would talk to a real model or the network): `/compact`, `/handoff`, `/btw`, `/retry`, prompt templates, skills, `/usage`. That they start model requests comes from reading omp's code and docs, not from a run.

## Undocumented surfaces it relies on

| Surface | Used for | If it is missing |
| --- | --- | --- |
| `OverlayHandle.setHidden` (the handle is documented, its keys are not) | hide the HUD, return the focus to the editor | the command is not run, the HUD says so |
| `tui.getFocused()`, `tui.children` | find omp's editor | the command is not run, the HUD says so |
| `tui.hasOverlay()` | see that a viewer or dialog is open | focus alone decides |
| editor `submit()` / `disableSubmit` / `setText` | submit the line | the command is not run, the HUD says so |
| `ctx.ui.addAutocompleteProvider` (documented) | palette and name check | no palette; names are not checked |
| `ctx.ui.onTerminalInput` (documented) | swallow the "any key" | the HUD returns at once |

An omp update can break these. After updating omp run `/hud doctor` (`slash: editor yes (...)`) and try `/tools` in the full screen.

## Limits

- The output of a command is on omp's screen, not in the HUD's conversation panel; the panel only notes `ran in omp: <line>`.
- While a command waits for a key the HUD is hidden; `Esc` pressed then is swallowed too (it does not interrupt a running turn).
- Images pending in omp's editor would travel with the submitted line (omp's own behavior); the HUD cannot add attachments.
- With a sub-agent focused in omp's Agent Hub omp sends editor text to that sub-agent and rejects `/` commands; an extension cannot see that state (unknown).
- Some valid inputs start a model request (see the README). That is omp's behavior, not the HUD's.

## Why there is no `/hud reload`

`ExtensionCommandContext` has `ctx.reload()`, and omp has `/reload-plugins`, so reloading the HUD after an update without restarting omp looked possible. It is not (omp 18.8.9): a test extension loaded with `-e`, whose message constant was changed on disk before `ctx.reload()` (with and without a persisted session) and before `/reload-plugins`, kept printing the old message, and its module and factory were not evaluated again (a module-level log line ran once). In omp's code `ctx.reload()` re-reads the session file (`session.reload()` -> `switchSession` of the same file, a no-op without a session file) and `/reload-plugins` refreshes skills, slash commands and MCP servers; neither re-imports extension modules (omp's extension docs say the same for live settings changes: modules are not unloaded or re-evaluated). Restart omp after updating the HUD.
