# @kawaz/claude-statusline

> English | [日本語](./README-ja.md)

[![CI](https://github.com/kawaz/claude-statusline/actions/workflows/ci.yml/badge.svg)](https://github.com/kawaz/claude-statusline/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A dense, information-rich `statusLine` for Claude Code (bun-based CLI).

- Context usage / 5h / 7d rate limits / model name shown as ANSI bars
- Project VCS state (jj or git) with OSC 8 hyperlinks
- One-click links to the repo root, VSCode, and the Remote (claude.ai) session
- Current PR number, title, and CI rollup via `gh` CLI (60s TTL file cache)
- Warns with a red-background line when the same session ID is running in multiple Claude processes (prevents transcript jsonl overwrite accidents)
- Honors `NO_COLOR` (SGR off, OSC 8 hyperlinks preserved)

## Screenshot

```
⏰▀▀▀▀▀▀▀▀▀▀3%/19%/4h01m 📆▀▀▀▀▀▀▀▀▀▀66%/74%/1d20h 🧠▋    8%    opus-4-7[1m]
📂[VSCode] kawaz/claude-statusline main@ ozwmpqsv 2202b65f 💬ebfc7063-...
```

When the same session ID is duplicated across processes:

```
📂[VSCode] kawaz/claude-statusline main@ ozwmpqsv 2202b65f 💬ebfc7063-...
⚠ DUPLICATE SESSION: quit other(s) before typing.
2026-06-04T17:10:06  31m57s  78178  busy  self
2026-06-04T17:18:14  23m49s   7418  idle  other
```

## Requirements

- [bun](https://bun.sh) — TypeScript runtime (required)
- [Claude Code](https://docs.claude.com/en/docs/claude-code) — writes to `~/.claude/settings.json`'s `statusLine`
- [`gh`](https://cli.github.com/) — PR rendering (optional; the line is hidden if missing)
- [`jj`](https://jj-vcs.dev/) or `git` — VCS info for the current cwd (optional; the line is hidden if both are missing)

## Setup

```bash
bun install
bun run src/cli.ts register    # writes statusLine.command into ~/.claude/settings.json
```

`register` writes an absolute-path `bun ... run` command pointing at this repo's `src/cli.ts`. Existing settings are preserved; pass `--force` to overwrite.

If you move the repo, re-run `bun run src/cli.ts register --force`.

After registering, restart Claude Code or open a new session to see the statusLine.

### Uninstall

```bash
# Edit ~/.claude/settings.json and remove the "statusLine" key
```

Or run `jq 'del(.statusLine)' ~/.claude/settings.json | sponge ~/.claude/settings.json`.

## Commands

| Command | Purpose |
|---|---|
| `run` | Reads Claude Code's JSON on stdin and writes the statusbar (the statusLine body itself) |
| `register` | Registers this CLI's `run` command into `~/.claude/settings.json` |
| `sample` | Sample bar rendering (visual / palette tuning) |

See `bun run src/cli.ts <command> --help` for details.

## Development

```bash
just              # list recipes
just ci           # lint + typecheck + test (single entry, mirrors CI)
just lint         # oxfmt + oxlint (--deny-warnings, with auto-fix)
just test [...]   # bun test
just sample       # sample output
just register     # register this repo's src/cli.ts
```

No `dist/` is produced — `src/cli.ts` is executed directly via bun.

### push

```bash
just push
```

- Gate chain: `ci` → `check-outdated-translations` (translation-pair commit-lag detection) → `check-version-bumped` (rejects `src/` changes without a version bump) → `bump-semver vcs push --branch main --jj-bookmark-auto-advance`
- A push is rejected if any translation pair is stale or the version was not bumped

### version bump

```bash
just bump-version           # patch
just bump-version minor
just bump-version major
```

`bump-semver --write` rewrites `$.version` in `package.json`, and `bump-semver vcs commit` produces the Release commit.

## Layout

- `src/cli.ts` — command dispatch, `register` implementation
- `src/statusbar.ts` — `run` body (stdin JSON → stdout statusbar)
- `src/bar.ts` — `contextBar` / `dualBar` / `colorize` / `utilColor` / `formatDuration`
- `src/ansi.ts` — ANSI SGR / OSC 8 helpers (`ansi.fg(n)`, `ansi.link(url, text)`, `ansi.strip(s)`, etc.)
- `src/sample.ts` — `sample` command
- `docs/decisions/` — Decision Records (DR), `INDEX.md` required
- `docs/findings/` — One-off investigation results (e.g. benchmarks)
- `docs/knowledge/` — Time-independent long-term notes (e.g. input JSON spec)
- `docs/issue/` — Self-repo TODOs and incoming requests from other projects

## License

MIT License. Copyright (c) Yoshiaki Kawazu (@kawaz).
