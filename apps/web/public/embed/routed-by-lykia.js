/*
 * "Routed by Lykia": a live strip of the Arc ecosystem for any site.
 *
 *   <div data-lykia-ecosystem data-limit="6"></div>
 *   <script async src="https://lykiaai.com/embed/routed-by-lykia.js"
 *           data-api="https://api.lykiaai.com"></script>
 *
 * Reads GET /v1/ecosystem (public, CORS-open). No cookies, no tracking,
 * no dependencies. Every value is written as text, never as HTML.
 */
(function () {
  "use strict";
  var script = document.currentScript;
  var api = (script && script.getAttribute("data-api")) || "https://api.lykiaai.com";
  var site = script && script.src ? new URL(script.src).origin : "https://lykiaai.com";

  function el(tag, style, text) {
    var node = document.createElement(tag);
    if (style) node.setAttribute("style", style);
    if (text !== undefined) node.textContent = String(text);
    return node;
  }

  function usd(value) {
    if (value === null || value === undefined) return "n/a";
    if (value >= 1e9) return "$" + (value / 1e9).toFixed(1) + "B";
    if (value >= 1e6) return "$" + (value / 1e6).toFixed(1) + "M";
    if (value >= 1e3) return "$" + Math.round(value / 1e3) + "K";
    return "$" + Math.round(value);
  }

  var ROLE = { routes: "ROUTABLE", reads: "READ-ONLY", lists: "MAPPED" };
  var FONT = "font-family:ui-monospace,SFMono-Regular,Menlo,monospace;";

  function render(host, data) {
    var limit = Math.max(1, Math.min(24, parseInt(host.getAttribute("data-limit") || "6", 10) || 6));
    var only = host.getAttribute("data-protocol");
    host.textContent = "";
    var box = el("div", FONT + "border:4px solid #1f3a5f;background:#f7f0df;color:#1d1a16;padding:12px;max-width:100%;box-sizing:border-box;");
    var head = el("div", "display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px;font-size:11px;letter-spacing:.12em;");
    head.appendChild(el("b", "", "THE ARC ECOSYSTEM · LIVE"));
    head.appendChild(el("span", "", (data.totals.routable || 0) + " ROUTABLE · " + (data.totals.protocols || 0) + " MAPPED · TVL " + usd(data.totals.tvlUsd)));
    box.appendChild(head);
    var list = el("ul", "list-style:none;margin:10px 0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,180px),1fr));gap:6px;");
    var rows = (data.protocols || []).filter(function (p) {
      return p.category !== "circle" && (!only || p.id === only);
    });
    rows.slice(0, limit).forEach(function (p) {
      var li = el("li", "padding:8px;background:#fffaf0;box-shadow:inset 0 0 0 2px #c9b88f;min-width:0;");
      li.appendChild(el("div", "font-size:13px;font-weight:700;overflow-wrap:anywhere;", p.name));
      li.appendChild(el("div", "font-size:10px;letter-spacing:.1em;margin-top:4px;color:#5b5346;", (ROLE[p.lykia] || "MAPPED") + " · TVL " + usd(p.tvlUsd)));
      list.appendChild(li);
    });
    box.appendChild(list);
    var foot = el("a", "display:block;text-align:right;font-size:10px;letter-spacing:.12em;color:#1f3a5f;text-decoration:none;", "ROUTED BY LYKIA · BUILT ON ARC NETWORK · POWERED BY CIRCLE");
    foot.setAttribute("href", site + "/ecosystem");
    foot.setAttribute("target", "_blank");
    foot.setAttribute("rel", "noopener");
    box.appendChild(foot);
    host.appendChild(box);
  }

  function start() {
    var hosts = document.querySelectorAll("[data-lykia-ecosystem]");
    if (hosts.length === 0) return;
    fetch(api.replace(/\/$/, "") + "/v1/ecosystem?environment=mainnet", { credentials: "omit" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (data) {
        for (var i = 0; i < hosts.length; i++) render(hosts[i], data);
      })
      .catch(function () {
        for (var i = 0; i < hosts.length; i++) hosts[i].textContent = "The Arc ecosystem is loading elsewhere: " + site + "/ecosystem";
      });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
