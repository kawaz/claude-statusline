import { contextBar, dualBar } from "./bar";

interface Spec {
  type: "ctx" | "5h" | "7d";
  range: [number, number];
  elapsed?: [number, number];
}

const WINDOW_HOURS: Record<string, number> = { "5h": 5, "7d": 7 * 24 };

function divide(range: [number, number], n: number): number[] {
  const step = (range[1] - range[0]) / n;
  return Array.from({ length: n + 1 }, (_, i) => Math.round(range[0] + step * i));
}

function interpolate(range: [number, number], count: number): number[] {
  if (count <= 1) return [range[0]];
  return Array.from({ length: count }, (_, i) =>
    Math.round(range[0] + (i / (count - 1)) * (range[1] - range[0])),
  );
}

function pad(vals: number[], len: number): number[] {
  const out = [...vals];
  while (out.length < len) out.push(out[out.length - 1]);
  return out;
}

function formatRemaining(elapsedPct: number, windowHours: number): string {
  const remainMs = Math.max(0, (1 - elapsedPct / 100) * windowHours * 3600_000);
  const totalM = Math.floor(remainMs / 60_000);
  const m = totalM % 60;
  const totalH = Math.floor(totalM / 60);
  const h = totalH % 24;
  const d = Math.floor(totalH / 24);
  const pp = (n: number) => String(n).padStart(2, "0");
  if (d > 0) return `${d}d${pp(h)}h`;
  if (totalH >= 10) return `${pp(totalH)}h${pp(m)}m`;
  if (totalH >= 1) return `${totalH}h${pp(m)}m`;
  return `${pp(totalM)}m`;
}

function visibleLength(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\]8;;[^\x07]*\x07/g, "").length;
}

function renderCols(
  specs: Spec[],
  allPrimary: number[][],
  totalRows: number,
  row: number,
): string[] {
  const BAR_WIDTH = 10;
  const cols: string[] = [];
  for (let si = 0; si < specs.length; si++) {
    const spec = specs[si];
    const util = pad(allPrimary[si], totalRows)[row];
    if (spec.type === "ctx") {
      cols.push(`🧠 ${contextBar(util, BAR_WIDTH)}`);
    } else {
      const elapsedVals = spec.elapsed ? interpolate(spec.elapsed, totalRows) : pad([0], totalRows);
      const elapsed = elapsedVals[row];
      const emoji = spec.type === "5h" ? "⏰" : "📆";
      const TU = util >= 80 ? "196" : util >= 50 ? "220" : "40";
      const rst = "\x1b[0m";
      const remaining = formatRemaining(elapsed, WINDOW_HOURS[spec.type]);
      cols.push(
        `${emoji} ${dualBar(util, elapsed, BAR_WIDTH)} \x1b[38;5;${TU}m${util}%${rst}/\x1b[38;5;39m${elapsed}%${rst}/\x1b[38;5;24m${remaining}${rst}`,
      );
    }
  }
  return cols;
}

export function runSample(args: string[]): void {
  const defaultArgs = ["10", "ctx", "0-100", "5h", "0-30/0-100", "7d", "0-80/0-30"];

  if (args.includes("--help") || args.length === 0) {
    console.log(`Usage: kawaz-claude-statusline sample [<n> <type> <range> ...]

Without arguments, shows default sample chart.

Arguments:
  n              Number of divisions (e.g. 4 for 0-100 produces 0,25,50,75,100)
  type           Bar type: ctx (context), 5h (5-hour), 7d (7-day)
  range          from-to[/elapsed-from-to] (e.g. 0-100, 0-100/20-50)

Examples:
  kawaz-claude-statusline sample
  kawaz-claude-statusline sample 10 ctx 0-100
  kawaz-claude-statusline sample 4 ctx 0-100 5h 0-100/20-50 7d 50-80/20-30

\x1b[2m# kawaz-claude-statusline sample ${defaultArgs.join(" ")}\x1b[0m`);
  }

  const effectiveArgs = args.length === 0 || args.includes("--help") ? defaultArgs : args;

  if (effectiveArgs.length < 3 || effectiveArgs.length % 2 === 0) {
    console.log("Usage: kawaz-claude-statusline sample [<n> <type> <range> ...]");
    return;
  }

  const n = parseInt(effectiveArgs[0]);
  if (n <= 0 || isNaN(n)) {
    console.error("n must be a positive integer");
    process.exit(1);
  }

  const specs: Spec[] = [];
  for (let i = 1; i < effectiveArgs.length; i += 2) {
    const type = effectiveArgs[i] as Spec["type"];
    const parts = effectiveArgs[i + 1].split("/");
    const [a, b] = parts[0].split("-").map(Number);
    const elapsed = parts[1] ? (parts[1].split("-").map(Number) as [number, number]) : undefined;
    specs.push({ type, range: [a, b], elapsed });
  }

  const allPrimary = specs.map((s) => divide(s.range, n));
  const totalRows = Math.max(...allPrimary.map((v) => v.length));

  // Pre-render all rows to compute column widths
  const rows = Array.from({ length: totalRows }, (_, r) =>
    renderCols(specs, allPrimary, totalRows, r),
  );
  const colWidths = specs.map((_, ci) => Math.max(...rows.map((r) => visibleLength(r[ci]))));

  for (const row of rows) {
    const padded = row.map((col, ci) => col + " ".repeat(colWidths[ci] - visibleLength(col)));
    console.log(padded.join(" | "));
    console.log();
  }
}
