/* global document, getComputedStyle, NodeFilter */
/**
 * Runs inside the page (passed to page.evaluate, so it must stay
 * self-contained). For every visible piece of text it reads the colour the
 * browser computed and the background it actually sits on: the background
 * colours of the element and its ancestors, laid over each other until one
 * is opaque. Opacity on the way up fades the text. It returns every text
 * below WCAG AA (4.5:1, or 3:1 for large text) and every text whose colour
 * equals its background.
 *
 * Kept as plain browser JavaScript: run.ts reads this file and evaluates it
 * in the page as it is.
 */
function measureContrast() {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const cache = new Map();
  // Any CSS colour (rgb, color(srgb), oklab, color-mix results) to sRGB through a one-pixel canvas.
  const rgba = (value) => {
    const hit = cache.get(value);
    if (hit) return hit;
    let out = { r: 0, g: 0, b: 0, a: 0 };
    if (value && value !== "transparent") {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "rgba(0,0,0,0)";
      ctx.fillStyle = value;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      out = { r, g, b, a: a / 255 };
    }
    cache.set(value, out);
    return out;
  };
  const over = (top, under) => {
    const a = top.a + under.a * (1 - top.a);
    if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
    const mix = (t, u) => (t * top.a + u * under.a * (1 - top.a)) / a;
    return { r: mix(top.r, under.r), g: mix(top.g, under.g), b: mix(top.b, under.b), a };
  };
  const lum = (c) => {
    const ch = (v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
  };
  const hex = (c) => `#${[c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
  const name = (el) => {
    const parts = [];
    for (let n = el; n && n !== document.body && parts.length < 3; n = n.parentElement) {
      const cls = [...n.classList].filter((c) => !c.startsWith("vt-")).slice(0, 2).join(".");
      parts.unshift(`${n.tagName.toLowerCase()}${cls ? `.${cls}` : ""}`);
    }
    return parts.join(" > ");
  };

  const page = rgba(getComputedStyle(document.documentElement).backgroundColor);
  const base = page.a >= 1 ? page : over(page, { r: 255, g: 255, b: 255, a: 1 });
  const backgroundOf = (el) => {
    const layers = [];
    for (let n = el; n; n = n.parentElement) {
      const c = rgba(getComputedStyle(n).backgroundColor);
      if (c.a > 0) layers.push(c);
      if (c.a >= 1) break;
    }
    let bg = layers.length > 0 && layers[layers.length - 1].a >= 1 ? { r: 0, g: 0, b: 0, a: 0 } : base;
    for (let i = layers.length - 1; i >= 0; i--) bg = over(layers[i], bg);
    return bg;
  };
  const fadeOf = (el) => {
    let o = 1;
    for (let n = el; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
    return o;
  };

  const seen = new Set();
  const issues = [];
  let checked = 0;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (t) => (/\S/u.test(t.nodeValue ?? "") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    const el = t.parentElement;
    if (!el || seen.has(el)) continue;
    seen.add(el);
    if (el.closest("script, style, noscript, template, svg, canvas, option, .sr-only")) continue;
    // Inactive controls are exempt (WCAG 1.4.3).
    if (el.closest(":disabled, [aria-disabled='true']")) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility !== "visible" || cs.display === "none") continue;
    const range = document.createRange();
    range.selectNodeContents(t);
    const box = range.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) continue;
    if (el.closest("details:not([open])") && !el.closest("summary")) continue;
    const fade = fadeOf(el);
    if (fade < 0.05) continue;
    checked += 1;
    const fill = cs.getPropertyValue("-webkit-text-fill-color");
    const raw = rgba(fill && fill !== cs.color && !/currentcolor/iu.test(fill) ? fill : cs.color);
    const bg = backgroundOf(el);
    const fg = over({ ...raw, a: raw.a * fade }, bg);
    const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
    const ratio = (hi + 0.05) / (lo + 0.05);
    const size = parseFloat(cs.fontSize);
    const bold = Number(cs.fontWeight) >= 700;
    const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
    const same = ratio < 1.2;
    if (ratio + 0.005 < need) {
      issues.push({ where: name(el), text: (t.nodeValue ?? "").trim().replace(/\s+/gu, " ").slice(0, 60), fg: hex(fg), bg: hex(bg), ratio: Math.round(ratio * 100) / 100, need, same });
    }
  }
  return { checked, issues };
}
