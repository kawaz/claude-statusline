# statusbar.ts サンプル入力

## コンテキストゼロ（セッション起動直後 / クリア後）

`used_percentage: null` のため、現行コードでは context bar が非表示になる問題あり。
→ `src/statusbar.ts` で `?? 0` にフォールバックして 0% 表示するよう修正済み。

```json
{
  "session_id": "d0d647a6-8674-4f56-bb8f-bc1846809a1d",
  "transcript_path": "/Users/kawaz/.claude/projects/-Users-kawaz--local-share-repos-github-com-kawaz-kuu-mbt-main/d0d647a6-8674-4f56-bb8f-bc1846809a1d.jsonl",
  "cwd": "/Users/kawaz/.local/share/repos/github.com/kawaz/kuu.mbt/main",
  "model": {
    "id": "claude-opus-4-6",
    "display_name": "Opus 4.6"
  },
  "workspace": {
    "current_dir": "/Users/kawaz/.local/share/repos/github.com/kawaz/kuu.mbt/main",
    "project_dir": "/Users/kawaz/.local/share/repos/github.com/kawaz/kuu.mbt/main",
    "added_dirs": [
      "/private/tmp",
      "/Users/kawaz/.dotfiles/local/share/repos/github.com/emeradaco/antenna"
    ]
  },
  "version": "2.1.72",
  "output_style": {
    "name": "default"
  },
  "cost": {
    "total_cost_usd": 0,
    "total_duration_ms": 553,
    "total_api_duration_ms": 0,
    "total_lines_added": 0,
    "total_lines_removed": 0
  },
  "context_window": {
    "total_input_tokens": 0,
    "total_output_tokens": 0,
    "context_window_size": 200000,
    "current_usage": null,
    "used_percentage": null,
    "remaining_percentage": null
  },
  "exceeds_200k_tokens": false
}
```

## コンテキスト使用中（20%）

```json
{
  "session_id": "32958474-a22c-4270-9fc3-d4d25dc4043e",
  "transcript_path": "/Users/kawaz/.claude/projects/-Users-kawaz--local-share-repos-github-com-kawaz-claude-statusline-main/32958474-a22c-4270-9fc3-d4d25dc4043e.jsonl",
  "cwd": "/Users/kawaz/.local/share/repos/github.com/kawaz/claude-statusline/main",
  "model": {
    "id": "claude-opus-4-6",
    "display_name": "Opus 4.6"
  },
  "workspace": {
    "current_dir": "/Users/kawaz/.local/share/repos/github.com/kawaz/claude-statusline/main",
    "project_dir": "/Users/kawaz/.local/share/repos/github.com/kawaz/claude-statusline/main",
    "added_dirs": [
      "/private/tmp",
      "/Users/kawaz/.dotfiles/local/share/repos/github.com/emeradaco/antenna"
    ]
  },
  "version": "2.1.72",
  "output_style": {
    "name": "default"
  },
  "cost": {
    "total_cost_usd": 0.6221452499999999,
    "total_duration_ms": 1070538,
    "total_api_duration_ms": 144743,
    "total_lines_added": 146,
    "total_lines_removed": 0
  },
  "context_window": {
    "total_input_tokens": 19,
    "total_output_tokens": 5560,
    "context_window_size": 200000,
    "current_usage": {
      "input_tokens": 3,
      "output_tokens": 657,
      "cache_creation_input_tokens": 503,
      "cache_read_input_tokens": 39692
    },
    "used_percentage": 20,
    "remaining_percentage": 80
  },
  "exceeds_200k_tokens": false
}
```
