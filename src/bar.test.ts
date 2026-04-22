import { describe, test, expect } from "bun:test";
import { calcElapsed, colorize, contextBar, dualBar, formatDuration, utilColor } from "./bar";
import { ansi } from "./ansi";

describe("ansi.strip", () => {
  test("removes SGR sequences", () => {
    expect(ansi.strip("\x1b[31mred\x1b[0m")).toBe("red");
  });
  test("removes 256-color sequences", () => {
    expect(ansi.strip("\x1b[38;5;196mtext\x1b[0m")).toBe("text");
  });
  test("removes OSC 8 hyperlink (BEL terminator)", () => {
    expect(ansi.strip("\x1b]8;;https://example\x07text\x1b]8;;\x07")).toBe("text");
  });
  test("removes OSC 8 hyperlink (ESC\\ terminator)", () => {
    expect(ansi.strip("\x1b]8;;https://example\x1b\\text\x1b]8;;\x1b\\")).toBe("text");
  });
  test("passes plain text through", () => {
    expect(ansi.strip("hello")).toBe("hello");
  });
});

describe("ansi.link", () => {
  test("strips control chars from url to prevent injection", () => {
    const link = ansi.link("https://a\x07b", "text");
    expect(link).not.toContain("\x07b");
    expect(ansi.strip(link)).toBe("text");
  });
  test("strips control chars from text", () => {
    const link = ansi.link("https://a", "te\x1bxt");
    expect(ansi.strip(link)).toBe("text");
  });
});

describe("utilColor", () => {
  test("red for >= 80", () => {
    expect(utilColor(80)).toBe(196);
    expect(utilColor(100)).toBe(196);
  });
  test("yellow for >= 50", () => {
    expect(utilColor(50)).toBe(220);
    expect(utilColor(79)).toBe(220);
  });
  test("green for < 50", () => {
    expect(utilColor(0)).toBe(40);
    expect(utilColor(49)).toBe(40);
  });
});

describe("formatDuration", () => {
  test("negative / zero returns 00m", () => {
    expect(formatDuration(-1000)).toBe("00m");
    expect(formatDuration(0)).toBe("00m");
  });
  test("sub-minute returns 00m", () => {
    expect(formatDuration(59_000)).toBe("00m");
  });
  test("minutes only", () => {
    expect(formatDuration(5 * 60_000)).toBe("05m");
    expect(formatDuration(59 * 60_000)).toBe("59m");
  });
  test("hours and minutes (1-9h)", () => {
    expect(formatDuration(3600_000 + 5 * 60_000)).toBe("1h05m");
    expect(formatDuration(9 * 3600_000 + 59 * 60_000)).toBe("9h59m");
  });
  test("hours (10-23h) zero-padded", () => {
    expect(formatDuration(10 * 3600_000)).toBe("10h00m");
    expect(formatDuration(23 * 3600_000 + 30 * 60_000)).toBe("23h30m");
  });
  test("days and hours", () => {
    expect(formatDuration(24 * 3600_000)).toBe("1d00h");
    expect(formatDuration(2 * 24 * 3600_000 + 5 * 3600_000)).toBe("2d05h");
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
      expect(ansi.strip(dualBar(50, 50, w))).toHaveLength(w);
    }
  });

  test("all cells are ▀", () => {
    expect(ansi.strip(dualBar(0, 0, 10))).toBe("▀".repeat(10));
    expect(ansi.strip(dualBar(100, 100, 10))).toBe("▀".repeat(10));
    expect(ansi.strip(dualBar(50, 30, 10))).toBe("▀".repeat(10));
  });

  test("width always matches", () => {
    expect(ansi.strip(dualBar(30, 20, 10))).toHaveLength(10);
  });
});

describe("contextBar", () => {
  test("visible width matches requested width", () => {
    for (const w of [5, 10, 20]) {
      expect(ansi.strip(contextBar(50, w))).toHaveLength(w);
    }
  });

  test("shows percentage text", () => {
    expect(ansi.strip(contextBar(50, 10))).toContain("50%");
    expect(ansi.strip(contextBar(100, 10))).toContain("100%");
  });

  test("0% text centered in avail area", () => {
    const plain = ansi.strip(contextBar(0, 10));
    expect(plain).toHaveLength(10);
    const idx = plain.indexOf("0%");
    expect(idx).toBe(4);
  });

  test("20% text centered in avail area", () => {
    const plain = ansi.strip(contextBar(20, 10));
    expect(plain).toHaveLength(10);
    const idx = plain.indexOf("20%");
    expect(idx).toBeGreaterThanOrEqual(4);
    expect(idx).toBeLessThanOrEqual(5);
  });

  test("45% text centered in avail area", () => {
    const plain = ansi.strip(contextBar(45, 10));
    expect(plain).toHaveLength(10);
    const idx = plain.indexOf("45%");
    expect(idx).toBe(6);
  });
});
