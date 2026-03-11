import { describe, test, expect } from "bun:test";
import { calcElapsed, colorize, contextBar, dualBar, stripAnsi } from "./bar";

describe("stripAnsi", () => {
  test("removes SGR sequences", () => {
    expect(stripAnsi("\x1b[31mred\x1b[0m")).toBe("red");
  });
  test("removes 256-color sequences", () => {
    expect(stripAnsi("\x1b[38;5;196mtext\x1b[0m")).toBe("text");
  });
  test("passes plain text through", () => {
    expect(stripAnsi("hello")).toBe("hello");
  });
});

describe("colorize", () => {
  test("red for >= 80", () => {
    expect(colorize("x", 80)).toBe("\x1b[31mx\x1b[0m");
    expect(colorize("x", 100)).toBe("\x1b[31mx\x1b[0m");
  });
  test("yellow for >= 50", () => {
    expect(colorize("x", 50)).toBe("\x1b[33mx\x1b[0m");
    expect(colorize("x", 79)).toBe("\x1b[33mx\x1b[0m");
  });
  test("green for < 50", () => {
    expect(colorize("x", 0)).toBe("\x1b[32mx\x1b[0m");
    expect(colorize("x", 49)).toBe("\x1b[32mx\x1b[0m");
  });
});

describe("calcElapsed", () => {
  const base = new Date("2026-03-11T12:00:00Z");

  test("invalid date returns 0", () => {
    expect(calcElapsed("invalid", 5)).toBe(0);
  });

  test("at window start returns 0", () => {
    const resetsAt = new Date(base.getTime() + 5 * 3600_000).toISOString();
    expect(calcElapsed(resetsAt, 5, base)).toBe(0);
  });

  test("at midpoint returns 50", () => {
    const resetsAt = new Date(base.getTime() + 2.5 * 3600_000).toISOString();
    expect(calcElapsed(resetsAt, 5, base)).toBe(50);
  });

  test("at window end returns 100", () => {
    expect(calcElapsed(base.toISOString(), 5, base)).toBe(100);
  });
});

describe("dualBar", () => {
  test("visible width matches requested width", () => {
    for (const w of [5, 10, 20]) {
      expect(stripAnsi(dualBar(50, 50, w))).toHaveLength(w);
    }
  });

  test("all cells are ▀", () => {
    expect(stripAnsi(dualBar(0, 0, 10))).toBe("▀".repeat(10));
    expect(stripAnsi(dualBar(100, 100, 10))).toBe("▀".repeat(10));
    expect(stripAnsi(dualBar(50, 30, 10))).toBe("▀".repeat(10));
  });

  test("width always matches", () => {
    expect(stripAnsi(dualBar(30, 20, 10))).toHaveLength(10);
  });
});

describe("contextBar", () => {
  test("visible width matches requested width", () => {
    for (const w of [5, 10, 20]) {
      expect(stripAnsi(contextBar(50, w))).toHaveLength(w);
    }
  });

  test("shows percentage text", () => {
    expect(stripAnsi(contextBar(50, 10))).toContain("50%");
    expect(stripAnsi(contextBar(100, 10))).toContain("100%");
  });

  test("0% text centered in avail area", () => {
    const plain = stripAnsi(contextBar(0, 10));
    expect(plain).toHaveLength(10);
    const idx = plain.indexOf("0%");
    expect(idx).toBe(4);
  });

  test("20% text centered in avail area", () => {
    const plain = stripAnsi(contextBar(20, 10));
    expect(plain).toHaveLength(10);
    const idx = plain.indexOf("20%");
    expect(idx).toBeGreaterThanOrEqual(4);
    expect(idx).toBeLessThanOrEqual(5);
  });

  test("45% text centered in avail area", () => {
    const plain = stripAnsi(contextBar(45, 10));
    expect(plain).toHaveLength(10);
    const idx = plain.indexOf("45%");
    expect(idx).toBe(6);
  });
});
