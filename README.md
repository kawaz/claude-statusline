# @kawaz/claude-statusline

Claude Code の statusLine として情報密度の高いステータス表示を出す CLI。

- コンテキスト使用率 / 5h・7d のレート制限 / モデル名を ANSI バーとして表示
- プロジェクトの VCS 状態（jj または git）を OSC 8 ハイパーリンク付きで表示
- リポジトリルート・VSCode・Remote（claude.ai）へのワンクリックリンク
- 現 PR 番号・タイトル・CI ステータス（`gh` CLI 経由）

## スクリーンショット

```
⏰▀▀▀▀▀▀▀▀▀▀3%/19%/4h01m 📆▀▀▀▀▀▀▀▀▀▀66%/74%/1d20h 🧠▋    8%    opus-4-7[1m]
📂[VSCode] kawaz/claude-statusline main@ ozwmpqsv 2202b65f 💬ebfc7063-...
```

## インストール

```bash
bun install
bun run src/cli.ts register    # ~/.claude/settings.json に statusLine.command を設定
```

`register` は既存設定を尊重する。上書きしたい場合は `--force`。

## コマンド

| コマンド | 用途 |
|---|---|
| `run` | stdin から Claude Code の JSON を受けて statusbar を出力（statusLine 本体） |
| `register` | `~/.claude/settings.json` に自分の `run` コマンドを登録 |
| `sample` | バーのサンプル表示（見た目確認・配色チューニング用） |

詳細は `bun run src/cli.ts <command> --help`。

## 開発

```bash
just           # lint + build + test
just lint      # oxfmt + oxlint (--deny-warnings, 自動修正あり)
just test      # bun test (build に依存)
just sample    # サンプル出力
just register  # 自分の dist/cli.js を登録
```

### push

```bash
just push
```

- `ensure-clean` (@ が空 change であることを検証) → `test` (= build → lint) → `jj bookmark set main -r @-` → `jj git push`
- lint で自動修正が走って @ が dirty になった場合は ensure-clean で失敗する（意図通り。新しいコミットに分離して再 push してください）

## ファイル構成

- `src/cli.ts` — コマンドディスパッチ
- `src/statusbar.ts` — `run` 本体（stdin JSON → stdout statusbar）
- `src/bar.ts` — `contextBar` / `dualBar` / `colorize` / `utilColor` / `formatDuration`
- `src/ansi.ts` — ANSI SGR / OSC 8 ユーティリティ（`ansi.fg(n)`, `ansi.link(url, text)`, `ansi.strip(s)` など）
- `src/sample.ts` — `sample` コマンド実装
- `src/install-handler.sh` — `register` が使うインストーラ

## ライセンス

MIT License. Copyright (c) Yoshiaki Kawazu (@kawaz).
