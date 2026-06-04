# Statusbar Benchmark

CLI の起動から statusbar 出力までを hyperfine で計測。
最適化の効果を測る基準。

## 測定環境

- macOS (Apple Silicon)
- bun 1.3.11
- jj/gh CLI が PATH 上に存在

## 計測コマンド

```bash
hyperfine --warmup 5 --runs 30 \
  'bun run src/cli.ts run < /tmp/sample-input2.json'
```

## 直近の結果

| Metric | Value |
|---|---|
| Mean ± σ | 73.9 ms ± 2.9 ms |
| Min / Max | 68.7 / 80.3 ms |
| Runs | 30 (warmup 5) |

## 測定上の注意

- `gh pr view` が cache hit or "PR なし" の場合の値。cache miss & 実 PR ありだと約 600 ms 増える
- 起動時間の大半は bun の初期化と TS パース
- `jj log` 1 回統合と PR cache (60s TTL) で従来比 ~10x の高速化を確認 (Performance agent 当時の実測 ~630ms → 現在 ~74ms)
