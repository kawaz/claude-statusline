import { describe, test, expect } from "bun:test";
import { configDirToHash, configDirToService } from "./statusbar";
import { formatRemaining, parseTarget } from "./token";

const home = process.env.HOME ?? "";
const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, "");

describe("configDirToService", () => {
  test("default dir CC", () => {
    expect(configDirToService(`${home}/.claude`, "CC")).toBe("Claude Code-credentials");
  });

  test("default dir ST", () => {
    expect(configDirToService(`${home}/.claude`, "ST")).toBe("Claude Code-credentials-ST");
  });

  test("non-default dir CC includes hash", () => {
    expect(configDirToService(`${home}/.claude-work2`, "CC")).toMatch(
      /^Claude Code-credentials-[a-f0-9]{8}$/,
    );
  });

  test("non-default dir ST includes hash and -ST", () => {
    expect(configDirToService(`${home}/.claude-work2`, "ST")).toMatch(
      /^Claude Code-credentials-[a-f0-9]{8}-ST$/,
    );
  });

  test("deterministic", () => {
    const a = configDirToService(`${home}/.claude-work2`, "CC");
    const b = configDirToService(`${home}/.claude-work2`, "CC");
    expect(a).toBe(b);
  });

  test("different dirs produce different hashes", () => {
    const a = configDirToService(`${home}/.claude-work2`, "CC");
    const b = configDirToService(`${home}/.claude-work3`, "CC");
    expect(a).not.toBe(b);
  });
});

describe("configDirToHash", () => {
  test("default dir returns empty string", () => {
    expect(configDirToHash(`${home}/.claude`)).toBe("");
  });

  test("non-default dir returns 8-char hex", () => {
    expect(configDirToHash(`${home}/.claude-work2`)).toMatch(/^[a-f0-9]{8}$/);
  });
});

describe("formatRemaining", () => {
  test("expired", () => {
    const now = Date.now();
    expect(strip(formatRemaining(now - 1000, now))).toBe("expired");
  });

  test("exactly now is expired", () => {
    const now = Date.now();
    expect(strip(formatRemaining(now, now))).toBe("expired");
  });

  test("minutes+seconds", () => {
    const now = Date.now();
    expect(strip(formatRemaining(now + 5 * 60_000 + 30_000, now))).toBe("05m30s");
  });

  test("hours+minutes", () => {
    const now = Date.now();
    expect(strip(formatRemaining(now + (2 * 60 + 15) * 60_000, now))).toBe("2h15m");
  });

  test("days+hours+minutes", () => {
    const now = Date.now();
    expect(strip(formatRemaining(now + (29 * 60 + 30) * 60_000, now))).toBe("1d05h30m");
  });
});

describe("parseTarget", () => {
  test("CC target", () => {
    expect(parseTarget("CC:/Users/test/.claude")).toEqual({
      type: "CC",
      configDir: "/Users/test/.claude",
    });
  });

  test("ST target", () => {
    expect(parseTarget("ST:/Users/test/.claude-work2")).toEqual({
      type: "ST",
      configDir: "/Users/test/.claude-work2",
    });
  });
});
