# QUESTIONS — ユーザ裁定待ちリスト

> 運用規約: ユーザ裁定が必要な確認事項 (設計分岐・命名・不可逆操作の可否など) を
> ここに集約する。チャットでは「XX-Q 待ち」とラベル参照だけで済ませ、正本は本ファイル。
> 回答は「NEXT-Q1=a」のようにラベル + 選択肢記号で OK (自由文も歓迎)。
> 裁定が下りたら該当セクションを削除し、内容は正規の記録先 (DR / issue / journal) へ反映する。

## NEXT-Q1: 次の優先作業はどれか

v0.1.7 リリース済み・ワークツリークリーンの状態で、次に着手する作業の選択。

- **a**: `docs/issue/` の実体化 — README-ja.md が言及しているが実在しない。local-issue plugin で初期化して整合させる (AI の推し: 数分で終わる不整合解消)
- **b**: v0.1.7 の実機動作確認 — ccmsg リンク / MC リンク表示の確認、問題あれば issue 化
- **c**: `docs/findings/2026-04-23-statusbar-benchmark.md` の再計測・更新
- **d**: 待機 (ccmsg 監視のみ継続)

参照: docs/findings/2026-04-23-statusbar-benchmark.md, README-ja.md の docs/issue 言及行
