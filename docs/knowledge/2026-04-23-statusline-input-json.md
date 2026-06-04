# statusbar.ts サンプル入力

Claude Code がステータスラインコマンドの stdin に渡す JSON。

## コンテキストゼロ（セッション起動直後 / クリア後）

`used_percentage: null` / `rate_limits` なしの場合。
→ `src/statusbar.ts` で `?? 0` にフォールバックして 0% 表示、使用量バーは非表示。

```json
{
  "session_id": "d0d647a6-8674-4f56-bb8f-bc1846809a1d",
  "transcript_path": "/path/to/transcript.jsonl",
  "cwd": "/path/to/project",
  "model": {
    "id": "claude-opus-4-6",
    "display_name": "Opus 4.6"
  },
  "workspace": {
    "current_dir": "/path/to/project",
    "project_dir": "/path/to/project"
  },
  "version": "2.1.80",
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

## コンテキスト使用中 + rate_limits あり

v2.1.80 以降、`rate_limits` が入力に含まれる。
`resets_at` は Unix タイムスタンプ（秒）。

```json
{
  "session_id": "ebfc7063-5d0c-49b5-983b-98a5156d6cf1",
  "transcript_path": "/path/to/transcript.jsonl",
  "cwd": "/path/to/project",
  "model": {
    "id": "claude-opus-4-6[1m]",
    "display_name": "Opus 4.6 (1M context)"
  },
  "workspace": {
    "current_dir": "/path/to/project",
    "project_dir": "/path/to/project",
    "added_dirs": [
      "/private/tmp"
    ]
  },
  "version": "2.1.80",
  "output_style": {
    "name": "default"
  },
  "cost": {
    "total_cost_usd": 0.99,
    "total_duration_ms": 227797,
    "total_api_duration_ms": 247595,
    "total_lines_added": 6,
    "total_lines_removed": 0
  },
  "context_window": {
    "total_input_tokens": 12971,
    "total_output_tokens": 9910,
    "context_window_size": 1000000,
    "current_usage": {
      "input_tokens": 1,
      "output_tokens": 4,
      "cache_creation_input_tokens": 141,
      "cache_read_input_tokens": 64415
    },
    "used_percentage": 6,
    "remaining_percentage": 94
  },
  "exceeds_200k_tokens": false,
  "rate_limits": {
    "five_hour": {
      "used_percentage": 56,
      "resets_at": 1774015200
    },
    "seven_day": {
      "used_percentage": 14,
      "resets_at": 1774587600
    }
  }
}
```
