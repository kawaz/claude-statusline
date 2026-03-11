export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

export function colorize(text: string, util: number): string {
  const code = util >= 80 ? 31 : util >= 50 ? 33 : 32;
  return `\x1b[${code}m${text}\x1b[0m`;
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

// Dual bar: top half = utilization, bottom half = elapsed time
// Each cell: ▀ (top only), ▄ (bottom only), █ (both), space (neither)
export function dualBar(util: number, elapsed: number, width: number): string {
  const TU = util >= 80 ? "196" : util >= 50 ? "220" : "40";
  const BU = "39";
  const BA = "24";
  const topFilled = Math.round((util / 100) * width);
  const botFilled = Math.round((elapsed / 100) * width);

  const TA = "240";
  let bar = "";
  for (let i = 0; i < width; i++) {
    const fg = i < topFilled ? TU : TA;
    const bg = i < botFilled ? BU : BA;
    bar += `\x1b[38;5;${fg}m\x1b[48;5;${bg}m▀`;
  }
  return bar + "\x1b[0m";
}

export function contextBar(pct: number, width: number): string {
  const ctxColor = pct >= 80 ? "196" : pct >= 50 ? "220" : "40";
  const ctxGray = pct >= 80 ? "52" : pct >= 50 ? "58" : "22";
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
  let bar = "";
  for (let i = 0; i < width; i++) {
    const isFull = i < fullCells;
    const isPartial = i === fullCells && onesDigit > 0;
    if (i >= ctxTextStart && i < ctxTextStart + ctxText.length) {
      if (isFull || isPartial) {
        bar += `\x1b[0m\x1b[1m\x1b[30m\x1b[48;5;${ctxColor}m${ctxText[i - ctxTextStart]}`;
      } else {
        bar += `\x1b[0m\x1b[1m\x1b[38;5;${ctxColor}m\x1b[48;5;${ctxGray}m${ctxText[i - ctxTextStart]}`;
      }
    } else if (isPartial) {
      bar += `\x1b[0m\x1b[38;5;${ctxColor}m\x1b[48;5;${ctxGray}m${partialChar}`;
    } else {
      bar += `\x1b[0m\x1b[48;5;${isFull ? ctxColor : ctxGray}m `;
    }
  }
  bar += "\x1b[0m";
  return bar;
}
