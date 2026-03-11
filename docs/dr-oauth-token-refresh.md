# Design Record: OAuth Token Refresh

## 背景

Claude Code の OAuth アクセストークンは有効期限（通常8時間）があり、期限切れ後は Usage API が認証エラーを返す。
statusline ツールは Keychain から読み取ったトークンをそのまま使用していたため、期限切れ時に 5h/7d グラフが完全に非表示になっていた。

## 決定事項

### 1. 独立トークンチェーン（2系統分離）

Claude Code のリフレッシュトークンはローテーション方式（使用すると旧トークンが無効化される）。
statusline が Claude Code のトークンを直接リフレッシュすると、Claude Code のセッションが死ぬ。

**解決策**: statusline 専用の Keychain エントリ（`-statusline` suffix）を持ち、独立したトークンチェーンで運用する。

- 初回: Claude Code のエントリをコピーして `-statusline` エントリを作成
- 以降: statusline は自身のリフレッシュトークンで独自にリフレッシュ
- 初回リフレッシュ時に Claude Code 側のトークンが無効化される → ユーザーが `/login` で再認証（一度きり）
- 再認証後は2系統が完全独立し、互いに影響しない

### 2. Stale キャッシュフォールバック

API 呼び出し失敗時（トークン期限切れ、ネットワークエラー、Rate Limit 等）に、TTL 超過済みのキャッシュデータを返す。
null を返してグラフを非表示にするより、古いデータでも表示する方がユーザーにとって有用。

### 3. リフレッシュ失敗時の再シード

statusline のリフレッシュトークンが無効化された場合（例: Keychain を手動削除した後など）、Claude Code の最新エントリから再コピーして復旧を試みる。

## Keychain エントリ

| エントリ | 用途 | 管理者 |
|---|---|---|
| `Claude Code-credentials` | Claude Code 本体用 | Claude Code |
| `Claude Code-credentials-statusline` | statusline 専用 | statusline |

- `acct` フィールド: `$USER`（新しい Claude Code は `acct` 付きで保存する）
- 読み取り時は `-a $USER` を優先し、フォールバックで `-a` なしも試行

## OAuth Token Refresh API

### エンドポイント

```
POST https://platform.claude.com/v1/oauth/token
```

注意: Usage API (`api.anthropic.com`) とは別ホスト。

### リクエスト

```json
{
  "grant_type": "refresh_token",
  "refresh_token": "sk-ant-ort01-...",
  "client_id": "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
  "scope": "user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload"
}
```

- `Content-Type: application/json`
- `client_id` は Claude Code バイナリからの調査値

### レスポンス（成功時）

```json
{
  "access_token": "sk-ant-oat01-...",
  "refresh_token": "sk-ant-ort01-...",
  "expires_in": 28800,
  "scope": "..."
}
```

- `expires_in`: 秒数（通常 28800 = 8時間）
- `refresh_token`: 新しいリフレッシュトークン（ローテーション方式）

### エラー時

- `400 invalid_grant`: リフレッシュトークンが無効または失効 → CC エントリから再シード
- `429`: Rate Limit → stale キャッシュにフォールバック

## 制約・注意事項

- `client_id` と `scope` は Claude Code バイナリからの調査値であり、将来変更される可能性がある
- `CLAUDE_CONFIG_DIR` が設定されている場合、Keychain サービス名にセッションハッシュが含まれる（`Claude Code-credentials-${hash}-statusline`）
