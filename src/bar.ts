import { ansi } from "./ansi";

// xterm-256 color codes for utilization severity:
// 196 = red (>=80%), 220 = yellow (>=50%), 40 = green (<50%).
export function utilColor(util: number): number {
  return util >= 80 ? 196 : util >= 50 ? 220 : 40;
}

export function formatDuration(ms: number): string {
  const totalM = Math.floor(Math.max(0, ms) / 60_000);
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

export function colorize(text: string, util: number): string {
  const code = util >= 80 ? 31 : util >= 50 ? 33 : 32;
  return `${ansi.sgr(code)}${text}${ansi.reset}`;
}

export function calcElapsed(resetsAt: string, windowHours: number, now?: Date): number {
  const reset = new Date(resetsAt);
  if (isNaN(reset.getTime())) return 0;
  const nowMs = (now ?? new Date()).getTime();
  const windowMs = windowHours * 3600_000;
  const windowStart = reset.getTime() - windowMs;
  const elapsed = ((nowMs - windowStart) / windowMs) * 100;
  return Math.max(0, Math.min(100, elapsed));
}

const clamp = (x: number) => Math.min(100, Math.max(0, x));

// Dual bar: top half = utilization, bottom half = elapsed time
// Each cell: ▀ (top only), ▄ (bottom only), █ (both), space (neither)
export function dualBar(util: number, elapsed: number, width: number): string {
  util = clamp(util);
  elapsed = clamp(elapsed);
  const fgFilled = ansi.fg(utilColor(util));
  const fgEmpty = ansi.fg(240);
  const bgFilled = ansi.bg(39);
  const bgEmpty = ansi.bg(24);
  const topFilled = Math.round((util / 100) * width);
  const botFilled = Math.round((elapsed / 100) * width);

  let bar = "";
  for (let i = 0; i < width; i++) {
    const fg = i < topFilled ? fgFilled : fgEmpty;
    const bg = i < botFilled ? bgFilled : bgEmpty;
    bar += `${fg}${bg}▀`;
  }
  return bar + ansi.reset;
}

export function contextBar(pct: number, width: number): string {
  pct = clamp(pct);
  const ctxColor = utilColor(pct);
  const ctxGray = pct >= 80 ? 52 : pct >= 50 ? 58 : 22;
  const fullCells = Math.floor(pct / 10);
  const onesDigit = pct % 10;
  const blockChars = " ▏▎▍▌▋▊▉█";
  const partialChar = blockChars[Math.round((onesDigit * 8) / 9)] ?? "█";
  const ctxText = `${pct}%`;
  const effectiveFilled = onesDigit >= 7 ? fullCells + 1 : fullCells;
  let ctxTextStart: number;
  if (effectiveFilled >= Math.ceil(width / 2)) {
    const visualWidth = fullCells + Math.max(0, onesDigit - 1) / blockChars.length;
    ctxTextStart = Math.round((visualWidth - ctxText.length) / 2);
    if (ctxTextStart < 0) ctxTextStart = 0;
  } else {
    // Center text in the avail (empty) area
    const availStart = fullCells + (onesDigit > 0 ? 1 : 0);
    const availWidth = width - availStart;
    ctxTextStart = availStart + Math.round((availWidth - ctxText.length) / 2);
    if (ctxTextStart + ctxText.length > width) ctxTextStart = width - ctxText.length;
  }
  // Pre-compute SGR prefixes for each cell type (reset each cell to avoid attribute bleed)
  const bold = ansi.sgr(1);
  const black = ansi.sgr(30);
  const textOnFull = `${ansi.reset}${bold}${black}${ansi.bg(ctxColor)}`;
  const textOnEmpty = `${ansi.reset}${bold}${ansi.fg(ctxColor)}${ansi.bg(ctxGray)}`;
  const partialCell = `${ansi.reset}${ansi.fg(ctxColor)}${ansi.bg(ctxGray)}`;
  const fullCell = `${ansi.reset}${ansi.bg(ctxColor)}`;
  const emptyCell = `${ansi.reset}${ansi.bg(ctxGray)}`;

  let bar = "";
  for (let i = 0; i < width; i++) {
    const isFull = i < fullCells;
    const isPartial = i === fullCells && onesDigit > 0;
    if (i >= ctxTextStart && i < ctxTextStart + ctxText.length) {
      bar += `${isFull || isPartial ? textOnFull : textOnEmpty}${ctxText[i - ctxTextStart]}`;
    } else if (isPartial) {
      bar += `${partialCell}${partialChar}`;
    } else {
      bar += `${isFull ? fullCell : emptyCell} `;
    }
  }
  return bar + ansi.reset;
}
