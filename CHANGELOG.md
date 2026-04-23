# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Session ID display on second line (💬 prefix)
- Model name shown from `input.model.id` (with `claude-` prefix stripped, `[1m]` suffix dimmed)
- `NO_COLOR` env var support (https://no-color.org/) — disables SGR while keeping OSC 8 hyperlinks
- `ansi.link()` sanitizes control chars in URL/text to prevent terminal injection from PR titles, etc.
- `ansi.strip()` handles OSC 8 with both BEL and `ESC\` terminators
- `dualBar`/`contextBar` clamp inputs to `[0, 100]`
- `gh pr view` result is cached at `$XDG_CACHE_HOME/claude-statusline/pr/...json` with 60s TTL (see `docs/dr-gh-pr-cache.md`)
- GitHub Actions CI for lint + test (uses `taiki-e/install-action` and `actions/checkout@v6`)
- `just push` recipe with `ensure-clean` guard (rejects dirty working copy)
- README and CHANGELOG

### Changed
- Refactored ANSI escape generation into `src/ansi.ts` module (`ansi.fg/bg/dim/sgr/link/strip`)
- Extracted `utilColor()` and `formatDuration()` into `src/bar.ts` (deduplicates 3 sites)
- Combined two `jj log` calls into one (~22 ms saved per render)
- `dist/` is no longer tracked; `register` writes an absolute path to `src/cli.ts`
- Bar/info layout: removed extra spaces after emojis, joined `|` separators with single spaces, grouped 🧠 with model name

### Fixed
- Pass `--` separator to `grep` for `transcript_path` (option-injection guard)
- Skip `gh pr view` when branch starts with `-` (avoids being parsed as option)
- Null-guard `pr.title` and `plainBms`
- Suppress noisy errors: invalid JSON now prints a short message instead of stack trace; git fallback's `fatal: not a git repository` no longer leaks to user terminal

### Removed
- `dist/` directory and historical commits referencing `dist/**`
