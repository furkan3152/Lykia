/**
 * Collects the text a person can see on the page: every non-empty text
 * node whose element is rendered, not hidden and inside the viewport's
 * document flow, plus the aria-label, title and placeholder attributes a
 * screen reader or a tooltip shows. Runs inside the page.
 */
function visibleTexts() {
  const out = [];
  const seen = (el) => {
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) === 0) return false;
      if (e.getAttribute("aria-hidden") === "true") return false;
    }
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.nodeValue.replace(/\s+/g, " ").trim();
    if (!t) continue;
    const el = n.parentElement;
    if (!el || el.closest("script,style,noscript,svg,code,pre,[data-i18n-skip]")) continue;
    if (!seen(el)) continue;
    out.push({ kind: "text", text: t });
  }
  for (const el of document.querySelectorAll("[aria-label],[title],[placeholder]")) {
    if (el.closest("[data-i18n-skip]")) continue;
    for (const a of ["aria-label", "title", "placeholder"]) {
      const v = el.getAttribute(a);
      if (v && v.trim()) out.push({ kind: a, text: v.trim() });
    }
  }
  out.push({ kind: "title", text: document.title });
  return out;
}
