// ANSI escape utilities for terminal styling (SGR) and OSC 8 hyperlinks.
// Ref: ECMA-48 (CSI), XTerm ctlseqs (OSC), OSC 8 hyperlink spec.
// Honors NO_COLOR (https://no-color.org): disables SGR but keeps OSC 8 links.

const ESC = "\x1B";
const BEL = "\x07";

const CSI = `${ESC}[`; // Control Sequence Introducer: ESC [
const OSC = `${ESC}]`; // Operating System Command:    ESC ]
const ST = BEL; // String Terminator (BEL variant; ESC\ is the canonical form but BEL has broader support)

const NO_COLOR = (process.env.NO_COLOR ?? "") !== "";

// SGR = Select Graphic Rendition: CSI <params> m
const sgr: (params: string | number) => string = NO_COLOR
  ? () => ""
  : (params) => `${CSI}${params}m`;

// OSC 8 hyperlink: OSC 8 ; ; URI ST  text  OSC 8 ; ; ST
const hyperlinkOpen = (url: string) => `${OSC}8;;${url}${ST}`;
const hyperlinkClose = `${OSC}8;;${ST}`;

// Strip ALL C0 (U+0000..U+001F, U+007F) and C1 (U+0080..U+009F) control chars.
// Used for URLs which must not contain raw control bytes.
const sanitizeUrl = (s: string) => {
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

// Sanitize link text: preserve SGR sequences (color in hyperlink is fine),
// strip other control chars that could close the OSC 8 early (BEL) or move
// the cursor (other ESC sequences).
const sanitizeLinkText = (s: string) => {
  const sgrs = s.match(sgrRe) ?? [];
  const parts = s.split(sgrRe);
  let out = "";
  for (let i = 0; i < parts.length; i++) {
    out += sanitizeUrl(parts[i] ?? "");
    if (i < sgrs.length) out += sgrs[i];
  }
  return out;
};

export const ansi = {
  reset: sgr(0),
  dim: sgr(2),
  fg: (n: number) => sgr(`38;5;${n}`),
  bg: (n: number) => sgr(`48;5;${n}`),
  sgr,
  link: (url: string, text: string) =>
    `${hyperlinkOpen(sanitizeUrl(url))}${sanitizeLinkText(text)}${hyperlinkClose}`,
  strip: (s: string) => s.replace(sgrRe, "").replace(osc8Re, ""),
};
