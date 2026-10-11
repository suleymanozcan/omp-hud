# omp-hud

English | [Türkçe](README.tr.md)

Terminal HUD for [oh-my-pi](https://github.com/can1357/oh-my-pi) (`omp`): an animated agent core, sub-agent nodes, a live feed, tasks and token gauges, inspired by sci-fi cockpit HUDs. Unofficial community extension; it installs into a stock `omp`, no fork.

![Fullscreen HUD: agent core with sub-agent nodes, live feed, tasks and token gauges](docs/img/hud-fullscreen.png)

*Rendered from the HTML preview (`scripts/preview.ts`); braille looks denser in a real terminal.*

## Features

- **Animated agent core** in the middle: the main agent, with its current state (idle, thinking, streaming, running a tool).
- **Sub-agent nodes** orbit the core: a running node pulses, a finished one turns green, a failed one turns red.
- **Live feed** of tool calls, sub-agent starts and finishes, retries and context compaction.
- **Tasks**: your todo list with progress.
- **Token gauges**: input / output / cache tokens, context window usage in %, tokens per second and cost.
- **Compact widget** below the editor (3 lines), always on once a session starts.
- **Fullscreen mode** with `/hud`, on the alternate screen; the normal screen is restored on exit.
- **`/hud demo`**: a fake event stream (about 45 s loop) so you can see everything without spending a token.
- **English and Turkish** UI (`en` / `tr`, auto-detected, switchable at runtime).

![Compact widget below the editor](docs/img/hud-compact.png)

## Install

Requires `omp` (oh-my-pi) with extension support. Developed and tested on **omp 18.8.9** only (see [Compatibility](#compatibility-and-honest-limits)). There is no build step and no dependencies: omp runs the TypeScript directly.

### From GitHub (main method)

```sh
omp plugin install github:suleymanozcan/omp-hud
```

`omp install github:suleymanozcan/omp-hud` is an alias, and `git+https://github.com/suleymanozcan/omp-hud.git` works as the spec too (omp's git spec grammar: `github:user/repo[#ref]`, `git+https://...`, `git@github.com:user/repo`). Restart `omp` afterwards: extensions are loaded only at startup. Update with `omp plugin upgrade omp-hud`, remove with `omp plugin uninstall omp-hud`.

> Verified with omp 18.8.9 in an isolated profile: `omp plugin install github:suleymanozcan/omp-hud` installs `omp-hud@0.1.0`; `omp plugin list` and `omp plugin doctor` report it healthy; `/hud help` and `/hud lang en` work after a restart. `omp install github:suleymanozcan/omp-hud`, `git+https://github.com/suleymanozcan/omp-hud.git` and `omp plugin upgrade omp-hud` were run the same way and succeeded (the `git@github.com:` form was not run).

### From a local clone (tested)

```sh
git clone https://github.com/suleymanozcan/omp-hud.git
omp plugin link ./omp-hud
```

`omp plugin link` symlinks the clone into omp's plugin directory (`omp install ./omp-hud` does the same). Update with `git pull` in the clone. Restart `omp` afterwards.

### Symlink into the extensions directory (tested)

```sh
mkdir -p ~/.omp/agent/extensions
ln -s "$PWD/omp-hud" ~/.omp/agent/extensions/hud
```

omp scans `~/.omp/agent/extensions/<name>/` and reads `package.json#omp.extensions`.

> A redirect file such as `~/.omp/agent/extensions/hud/index.ts` containing `export { default } from "/path/to/omp-hud/index.ts"` does **not** work: omp cannot resolve `@oh-my-pi/pi-tui` from the redirect file. Use a symlink to the whole directory.

### Try it without installing (tested)

```sh
omp -e ./omp-hud
```

### Config file (tested)

In `~/.omp/agent/config.yml` (use the full path of your clone):

```yaml
extensions:
  - /absolute/path/to/omp-hud
```

## Usage

| Command | Effect |
| --- | --- |
| `/hud` | Open the fullscreen HUD. |
| `/hud demo` | Fullscreen HUD driven by a fake event stream (does not touch the real session state). |
| `/hud compact on\|off` | Show or hide the compact widget below the editor (no argument: toggle). |
| `/hud lang tr\|en\|auto` | Switch the UI language for this run (not persisted); no argument shows the current one. |
| `/hud help` | Print the command summary. |

Keys in fullscreen:

| Key | Effect |
| --- | --- |
| `Esc` | Close the node details if open, otherwise leave the HUD. |
| `q` | Leave the HUD. |
| `←` / `→` / `Tab` | Select the previous / next node (`Shift+Tab` also goes back). |
| `Enter` | Open or close the details of the selected node. |
| `c` | Clear the selection. |

### Language

The UI follows `OMP_HUD_LANG=en|tr`; if unset, the first non-empty of `LC_ALL`, `LC_MESSAGES`, `LANG` decides (`tr…` gives Turkish), otherwise English.

```sh
OMP_HUD_LANG=en omp
```

## Preview without omp

You only need [Bun](https://bun.sh). Nothing here starts omp or calls a model; the demo runs on virtual time.

```sh
# watch live in your terminal (alternate screen, ~15 fps; Esc / q / Ctrl-C quits)
bun scripts/preview.ts --live

# print frames as 24-bit ANSI text
bun scripts/preview.ts --frames 3 --width 140 --height 40 --at 3,14,24

# write an HTML page (add --compact for the compact widget)
bun scripts/preview.ts --frames 2 --width 140 --height 40 --at 14,24 --compact --html /tmp/hud.html
```

`bun scripts/preview.ts --help` lists all options. The commands work from any directory.

## Compatibility and honest limits

- **Tested on omp 18.8.9 only** (macOS; Ghostty and cmux). Other omp versions and other terminals: unknown.
- **It relies on undocumented internals.** Sub-agent data comes from the `task:subagent:lifecycle` and `task:subagent:progress` events on `pi.events`, and fullscreen uses the overlay `fullscreen` option. Neither is a documented contract, so an omp update can break them. There are fallbacks: if the sub-agent events change, sub-agent nodes may stay empty while the core, feed, tasks and token gauges keep working; if `fullscreen` disappears, the HUD falls back to a normal overlay.
- **It does not replace omp's main view.** `setHeader` / `setFooter` have no effect in omp, so the HUD shows up only as the widget below the editor and as the fullscreen overlay.
- **You cannot type to the agent while fullscreen is open.** Focus is on the overlay; press `Esc` to get back.
- **Terminal:** braille and block characters are used heavily; a truecolor terminal (`COLORTERM=truecolor`) with a font that renders braille well is recommended. The terminal must be at least 50x14. The HUD is not installed in non-TUI modes.
- **Overlap with built-in features:** omp's Agent Hub (`Alt+A`) shows similar sub-agent data. If the built-in pinned "Subagents" block above the editor overlaps with the HUD, set `display.pinnedAgents: off`.

## Troubleshooting

- Nothing shows up: restart `omp` (extensions load only at startup) and run `/hud help`. If the command is unknown, the extension was not loaded.
- Look in the omp logs (`~/.omp/logs/`; a named profile logs to `~/.omp/profiles/<name>/logs/`) for `Failed to load extension`. Typical causes: a wrong or moved path, or a redirect file instead of a symlink (see above).
- Faded colors: set `COLORTERM=truecolor` in your terminal.
- Garbled fullscreen after a resize: resize once more and run `/hud` again.

## Development

```sh
bunx -p typescript tsc --noEmit -p .   # typecheck (plain `bunx tsc` resolves the wrong package)
bun scripts/smoke-collector.ts         # collector / store smoke checks
bun scripts/preview.ts --live          # look at it
```

There is no test suite yet.

```
index.ts                 extension entry: commands, timer
src/types.ts             data contract (HudState, HudStore, HudTheme)
src/store.ts             store
src/collector.ts         writes omp events into the store
src/demo.ts              fake event stream for /hud demo
src/i18n.ts              en / tr strings
src/render/              braille canvas, core, orbit, feed, tasks, tokens, layout
src/components/          FullHud (overlay), CompactHud (widget below the editor)
scripts/preview.ts       preview without omp (frames / HTML / live)
scripts/ansi-to-html.ts  ANSI to HTML converter for the preview
scripts/shim-pi-tui.ts   stand-in for pi-tui under plain bun (preview and smoke only)
```

## License

[MIT](LICENSE)
