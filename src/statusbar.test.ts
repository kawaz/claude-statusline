import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { findWorkspaceFile } from "./statusbar";

// findWorkspaceFile: VSCode リンクのリンク先決定。
// プロジェクトルートに *.code-workspace があればそれ (= VSCode の URL handler は
// .code-workspace 拡張子の path を multi-root workspace として開く) を、
// 無ければ null を返して呼び出し側が cwd を folder として開く。
describe("findWorkspaceFile", () => {
  const base = mkdtempSync(join(tmpdir(), "statusbar-test-"));
  afterAll(() => rmSync(base, { recursive: true, force: true }));

  // *.code-workspace が無い dir では null (= folder open への fallback 判定)。
  // 拡張子が部分一致する紛らわしい名前 (.code-workspace.bak) は対象外。
  test("returns null when dir has no *.code-workspace", () => {
    const dir = join(base, "plain");
    mkdirSync(dir);
    writeFileSync(join(dir, "README.md"), "");
    writeFileSync(join(dir, "foo.code-workspace.bak"), "{}");
    expect(findWorkspaceFile(dir)).toBeNull();
  });

  // 1 個あればその絶対 path。これが本機能の主ケース
  // (例: <repo>/main/kuu.code-workspace を workspace として開く)。
  test("returns the file path when exactly one exists", () => {
    const dir = join(base, "single");
    mkdirSync(dir);
    writeFileSync(join(dir, "kuu.code-workspace"), "{}");
    expect(findWorkspaceFile(dir)).toBe(join(dir, "kuu.code-workspace"));
  });

  // 複数ある場合は辞書順の先頭。statusline は描画のたびに再実行されるので、
  // 実行ごとにリンク先が揺れない決定性それ自体が仕様。
  test("returns lexicographically first when multiple exist", () => {
    const dir = join(base, "multi");
    mkdirSync(dir);
    writeFileSync(join(dir, "zzz.code-workspace"), "{}");
    writeFileSync(join(dir, "aaa.code-workspace"), "{}");
    expect(findWorkspaceFile(dir)).toBe(join(dir, "aaa.code-workspace"));
  });

  // dir が実在しない / 読めない場合も throw せず null (= statusline は入力 JSON の
  // path が消えていても描画を完了させることが最優先)。
  test("returns null for nonexistent dir", () => {
    expect(findWorkspaceFile(join(base, "no-such-dir"))).toBeNull();
  });
});
