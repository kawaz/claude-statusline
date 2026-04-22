// ANSI escape utilities for terminal styling (SGR) and OSC 8 hyperlinks.
// Ref: ECMA-48 (CSI), XTerm ctlseqs (OSC), OSC 8 hyperlink spec.

const ESC = "\x1B";
const BEL = "\x07";

const CSI = `${ESC}[`; // Control Sequence Introducer: ESC [
const OSC = `${ESC}]`; // Operating System Command:    ESC ]
const ST = BEL; // String Terminator (BEL variant; ESC\ is the canonical form but BEL has broader support)

// SGR = Select Graphic Rendition: CSI <params> m
const sgr = (params: string | number) => `${CSI}${params}m`;

// OSC 8 hyperlink: OSC 8 ; ; URI ST  text  OSC 8 ; ; ST
const hyperlinkOpen = (url: string) => `${OSC}8;;${url}${ST}`;
const hyperlinkClose = `${OSC}8;;${ST}`;

// Strip C0 (U+0000..U+001F, U+007F) and C1 (U+0080..U+009F) control chars
// that could break OSC 8 framing or inject SGR. URLs and link text must not
// contain raw control bytes; callers should use URL-encoding for literal bytes.
const sanitize = (s: string) => {
  let out = "";
  for (const ch of s) {
    const code = ch.charCodeAt(0);
    if (code >= 0x20 && code !== 0x7f && !(code >= 0x80 && code <= 0x9f)) {
      out += ch;
    }
  }
  return out;
};

const sgrRe = new RegExp(`${CSI}[0-9;]*m`, "g");
// OSC 8 terminator can be BEL or ESC\; match either, non-greedy.
const osc8Re = new RegExp(`${OSC}8;;.*?(?:${BEL}|${ESC}\\\\)`, "g");

export const ansi = {
  reset: sgr(0),
  dim: sgr(2),
  fg: (n: number) => sgr(`38;5;${n}`),
  bg: (n: number) => sgr(`48;5;${n}`),
  sgr,
  link: (url: string, text: string) =>
    `${hyperlinkOpen(sanitize(url))}${sanitize(text)}${hyperlinkClose}`,
  strip: (s: string) => s.replace(sgrRe, "").replace(osc8Re, ""),
};
