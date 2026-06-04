# Decision Records (DR) Index

claude-statusline の設計判断記録一覧。ファイル名は `DR-NNNN-title.md` (4 桁ゼロパディング)。`docs-structure` ルールに従い `## Active` / `## Archived` / `## Moved to research/` / `## Superseded` で区分する。

## Active

- [DR-0001](./DR-0001-gh-pr-cache.md) — `gh pr view` の file-based TTL キャッシュ (~620ms → 数 ms)
- [DR-0002](./DR-0002-imgcat-dualbar.md) — imgcat によるデュアルバー描画 (PoC 未実施)

## Archived

<!-- 現役の文脈を汚す古い DR は decisions/archive/ に退避し、ここに記載 -->

## Moved to research/

<!-- 判断記録の体を成さなくなり research/ に降格した DR -->

## Superseded

<!-- 後続 DR に上書きされた DR (Status: Superseded by DR-XXXX) -->
