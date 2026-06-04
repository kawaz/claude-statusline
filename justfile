# claude-statusline justfile
#
# Canonical task runner pattern; release/VCS shape is delegated to
# `bump-semver vcs` subcommands (DR-0020/0027/0028 in kawaz/bump-semver).

set shell := ["bash", "-euo", "pipefail", "-c"]

set script-interpreter := ["bash", "-euo", "pipefail"]

set positional-arguments

# default behaviour: alias for `list`
default: list

# show the recipe list
list:
    @just --list --unsorted

# ---------- atomic (lint / typecheck / test) ----------

# oxfmt + oxlint (auto-fix on)
lint:
    bunx oxfmt --write src/
    bunx oxlint --fix --deny-warnings src/

# tsc --noEmit
typecheck: lint
    bunx tsc --noEmit

# bun test
[script]
test *ARGS: typecheck
    bun test "$@"

# CI entry point (single source of truth)
ci: test

# ---------- runtime helpers ----------

# run the CLI locally, forwarding all args (e.g. `just run sample`)
[script]
run *ARGS:
    bun run src/cli.ts "$@"

# sample bars (alias for `run sample`)
[script]
sample *ARGS:
    bun run src/cli.ts sample "$@"

# register `statusLine.command` in ~/.claude/settings.json
register:
    bun run src/cli.ts register

# ---------- gates (push の内部、利用者が直接叩くことほぼなし) ----------

# working copy is clean (bump-semver vcs is clean)
[private]
ensure-clean:
    bump-semver vcs is clean

# translation pair freshness check via `bump-semver vcs outdated`
[private]
check-outdated-translations: ensure-clean
    bump-semver vcs outdated 'glob:**/*-ja.md' '$1/$2.md'

# fail if bump-trigger-paths changed since origin/main but package.json version was not bumped
check-version-bumped: (_check-version-bumped "src/" "package.json" "bun.lock")

# (helper) diff があれば package.json version が origin/main より上がっているか検証
[private]
[script]
_check-version-bumped *target_paths:
    if ! bump-semver vcs diff -q main@origin -- "$@"; then
        bump-semver compare gt package.json vcs:main@origin
    fi

# ---------- release flow ----------

# bump package.json version (default: patch) and create a release commit
[script]
bump-version level="patch": ensure-clean
    bump-semver "$1" package.json --write --quiet
    bump-semver vcs commit -m "Release v$(bump-semver get package.json)" package.json

# push to origin/main with gates
push: ci check-outdated-translations check-version-bumped
    bump-semver vcs push --branch main --jj-bookmark-auto-advance
