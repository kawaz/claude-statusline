# @kawaz/claude-statusline

> [English](./README.md) | 日本語

[![CI](https://github.com/kawaz/claude-statusline/actions/workflows/ci.yml/badge.svg)](https://github.com/kawaz/claude-statusline/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Claude Code の statusLine として情報密度の高いステータス表示を出す CLI (bun 前提)。

- コンテキスト使用率 / 5h・7d のレート制限 / モデル名を ANSI バーで表示
- プロジェクトの VCS 状態 (jj または git) を OSC 8 ハイパーリンク付きで表示
- リポジトリルート・VSCode・Remote (claude.ai) へのワンクリックリンク
- 現 PR 番号・タイトル・CI ステータス (`gh` CLI 経由、60s TTL でキャッシュ)
- 同じ session ID で複数 Claude プロセスが走っている場合に赤背景 + 警告行で通知 (jsonl 上書き事故防止)
- `NO_COLOR` 環境変数に対応 (SGR 無効、OSC 8 リンクは保持)

## スクリーンショット

```
⏰▀▀▀▀▀▀▀▀▀▀3%/19%/4h01m 📆▀▀▀▀▀▀▀▀▀▀66%/74%/1d20h 🧠▋    8%    opus-4-7[1m]
📂[VSCode] kawaz/claude-statusline main@ ozwmpqsv 2202b65f 💬ebfc7063-...
```

session ID 重複時:

```
📂[VSCode] kawaz/claude-statusline main@ ozwmpqsv 2202b65f 💬ebfc7063-...
⚠ DUPLICATE SESSION: quit other(s) before typing.
2026-06-04T17:10:06  31m57s  78178  busy  self
2026-06-04T17:18:14  23m49s   7418  idle  other
```

## 必要環境

- [bun](https://bun.sh) — TypeScript ランタイム (必須)
- [Claude Code](https://docs.claude.com/en/docs/claude-code) — `~/.claude/settings.json` の `statusLine` 設定先
- [`gh`](https://cli.github.com/) — PR 表示用 (任意。無い時はその行が出ないだけ)
- [`jj`](https://jj-vcs.dev/) または `git` — 現在 cwd の VCS 状態表示用 (無い時はその情報が出ないだけ)

## セットアップ

```bash
bun install
bun run src/cli.ts register    # ~/.claude/settings.json に statusLine.command を設定
```

`register` はこのリポの `src/cli.ts` の絶対パスを使う `bun ... run` コマンドを書き込む。既存設定を尊重。上書きしたい場合は `--force`。

リポを移動した場合は再度 `bun run src/cli.ts register --force`。

設定後、Claude Code を再起動するか、新しいセッションを開始すると statusLine が表示される。

### アンインストール

```bash
# ~/.claude/settings.json を編集して "statusLine" キーを削除
```

または `jq 'del(.statusLine)' ~/.claude/settings.json | sponge ~/.claude/settings.json` 等。

## コマンド

| コマンド | 用途 |
|---|---|
| `run` | stdin から Claude Code の JSON を受けて statusbar を出力 (statusLine 本体) |
| `register` | `~/.claude/settings.json` に自分の `run` コマンドを登録 |
| `sample` | バーのサンプル表示 (見た目確認・配色チューニング用) |

詳細は `bun run src/cli.ts <command> --help`。

## 開発

```bash
just              # レシピ一覧
just ci           # lint + typecheck + test (CI と同じ単一エントリ)
just lint         # oxfmt + oxlint (--deny-warnings, 自動修正あり)
just test [...]   # bun test
just sample       # サンプル出力
just register     # 自分の src/cli.ts を登録
```

dist/ は生成しない (src/cli.ts を直接 bun で実行する方針)。

### push

```bash
just push
```

- gate: `ci` → `check-outdated-translations` (翻訳ペア commit-lag 検出) → `check-version-bumped` (src/ 変更時の version 更新漏れ検出) → `bump-semver vcs push --branch main --jj-bookmark-auto-advance`
- 翻訳ペアや version 漏れがあれば push 拒否される

### version bump

```bash
just bump-version           # patch
just bump-version minor
just bump-version major
```

`bump-semver --write` で `package.json` の `$.version` を更新し、`bump-semver vcs commit` で Release commit を生成する。

## ファイル構成

- `src/cli.ts` — コマンドディスパッチ、`register` の実装
- `src/statusbar.ts` — `run` 本体 (stdin JSON → stdout statusbar)
- `src/bar.ts` — `contextBar` / `dualBar` / `colorize` / `utilColor` / `formatDuration`
- `src/ansi.ts` — ANSI SGR / OSC 8 ユーティリティ (`ansi.fg(n)`, `ansi.link(url, text)`, `ansi.strip(s)` など)
- `src/sample.ts` — `sample` コマンド実装
- `docs/decisions/` — 設計判断記録 (DR)、INDEX.md 必須
- `docs/findings/` — 単発調査の確定事実 (例: ベンチマーク)
- `docs/knowledge/` — 時系列依存しない長期ナレッジ (例: 入力 JSON 仕様)
- `docs/issue/` — 自リポ TODO + 他プロジェクトから受けた依頼

## ライセンス

MIT License. Copyright (c) Yoshiaki Kawazu (@kawaz).
