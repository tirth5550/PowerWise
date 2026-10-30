/* PowerWise shared code: theme, API calls, navigation, calculations, chart. */
(function (global) {
  "use strict";

  /* ---------------------------------------------------------- constants */
  const DEFAULT_THEME = { primary: "#1f9d55", accent: "#f5a800", bg: "#f6f8f5", hero1: "#e3f6e9", hero2: "#fff7dc" };
  const DEFAULT_TARIFF = { s1: 100, r1: 3.2, s2: 250, r2: 3.95, r3: 5.0, fixed: 25, duty: 15 };
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  const PRESETS = [
    { name: "Ceiling fan", watts: 75, hours: 10 },
    { name: "LED bulb", watts: 9, hours: 6 },
    { name: "Tube light", watts: 20, hours: 6 },
    { name: "Air conditioner (1.5 ton)", watts: 1500, hours: 6 },
    { name: "Refrigerator", watts: 150, hours: 8 },
    { name: "Television", watts: 100, hours: 4 },
    { name: "Washing machine", watts: 500, hours: 1 },
    { name: "Geyser / water heater", watts: 2000, hours: 1 },
    { name: "Water pump", watts: 750, hours: 1 },
    { name: "Microwave oven", watts: 1200, hours: 0.5 },
    { name: "Iron", watts: 1000, hours: 0.5 },
    { name: "Mixer grinder", watts: 500, hours: 0.5 },
    { name: "Laptop", watts: 60, hours: 6 },
    { name: "Wi-Fi router", watts: 10, hours: 24 },
  ];

  const STARTER_APPLIANCES = [
    { name: "Ceiling fan", watts: 75, hours: 10, qty: 3 },
    { name: "LED bulb", watts: 9, hours: 6, qty: 6 },
    { name: "Refrigerator", watts: 150, hours: 8, qty: 1 },
    { name: "Television", watts: 100, hours: 4, qty: 1 },
  ];

  /* ------------------------------------------------------------- colours */
  function parseHex(h) {
    h = String(h || "").replace("#", "");
    if (h.length === 3) h = h.split("").map(function (c) { return c + c; }).join("");
    if (!/^[0-9a-f]{6}$/i.test(h)) return [0, 0, 0];
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function toHex(rgb) {
    return "#" + rgb.map(function (v) {
      return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
    }).join("");
  }
  function mix(a, b, t) {
    const A = parseHex(a), B = parseHex(b);
    return toHex(A.map(function (v, i) { return v + (B[i] - v) * t; }));
  }
  function luminance(h) {
    const c = parseHex(h).map(function (v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  function applyTheme(t) {
    t = Object.assign({}, DEFAULT_THEME, t || {});
    const set = function (k, v) { document.documentElement.style.setProperty(k, v); };
    const dark = luminance(t.bg) < 0.18;
    const heroDark = luminance(mix(t.hero1, t.hero2, 0.5)) < 0.35;
    set("--primary", t.primary);
    set("--primary-dark", mix(t.primary, "#000000", 0.22));
    set("--on-primary", luminance(t.primary) > 0.5 ? "#10170f" : "#ffffff");
    set("--primary-tint", mix(t.primary, dark ? "#000000" : "#ffffff", dark ? 0.7 : 0.88));
    set("--accent", t.accent);
    set("--soft", mix(t.primary, dark ? "#000000" : "#ffffff", 0.4));
    set("--bg", t.bg);
    set("--bg-alt", dark ? mix(t.bg, "#ffffff", 0.05) : mix(t.bg, "#000000", 0.035));
    set("--card", dark ? mix(t.bg, "#ffffff", 0.08) : "#ffffff");
    set("--text", dark ? "#eef3ef" : "#17231b");
    set("--muted", dark ? "#a7b4ab" : "#5b6b60");
    set("--border", dark ? mix(t.bg, "#ffffff", 0.18) : mix(t.bg, "#000000", 0.12));
    set("--hero1", t.hero1);
    set("--hero2", t.hero2);
    set("--hero-text", heroDark ? "#f3f7f4" : "#17231b");
    set("--hero-muted", heroDark ? "#c9d4cc" : "#5b6b60");
    set("--nav-bg", (dark ? mix(t.bg, "#ffffff", 0.08) : "#ffffff") + "ee");
    set("--good", dark ? "#4ade80" : "#1f9d55");
    set("--bad", dark ? "#ff7b6b" : "#c0392b");
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  }

  function cacheTheme(t) {
    try { localStorage.setItem("pw_theme", JSON.stringify(t)); } catch (e) { /* ignore */ }
  }

  // apply the last known theme straight away so pages do not flash
  try {
    const cached = JSON.parse(localStorage.getItem("pw_theme") || "null");
    if (cached) applyTheme(cached);
  } catch (e) { /* ignore */ }

  /* ----------------------------------------------------------------- API */
  function ApiErr(status, message) {
    this.status = status;
    this.message = message;
  }

  async function api(method, url, body) {
    let res;
    try {
      res = await fetch(url, {
        method: method,
        headers: body !== undefined ? { "Content-Type": "application/json" } : {},
        body: body !== undefined ? JSON.stringify(body) : undefined,
        credentials: "same-origin",
      });
    } catch (e) {
      throw new ApiErr(0, "SERVER_OFFLINE");
    }
    const type = res.headers.get("content-type") || "";
    if (type.indexOf("application/json") === -1) throw new ApiErr(0, "SERVER_OFFLINE");
    const data = await res.json().catch(function () { return null; });
    if (!res.ok) throw new ApiErr(res.status, (data && data.error) || ("Error " + res.status));
    return data;
  }

  function showOffline() {
    if (document.getElementById("offlineBanner")) return;
    const bar = el("div", { class: "offline", id: "offlineBanner" },
      "PowerWise server is not running. In the VS Code terminal run ",
      el("code", { text: "python server.py" }),
      " and open the address it prints.");
    document.body.insertBefore(bar, document.body.firstChild);
  }

  async function refreshTheme() {
    try {
      const d = await api("GET", "/api/settings");
      applyTheme(d.theme);
      cacheTheme(d.theme);
      return d.theme;
    } catch (e) {
      return null;
    }
  }

  /* ----------------------------------------------------------------- DOM */
  function el(tag, props) {
    const e = document.createElement(tag);
    const p = props || {};
    Object.keys(p).forEach(function (k) {
      const v = p[k];
      if (v === null || v === undefined || v === false) return;
      if (k === "class") e.className = v;
      else if (k === "text") e.textContent = v;
      else if (k.slice(0, 2) === "on" && typeof v === "function") e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? "" : v);
    });
    Array.prototype.slice.call(arguments, 2).forEach(function add(kid) {
      if (kid === null || kid === undefined || kid === false) return;
      if (Array.isArray(kid)) { kid.forEach(add); return; }
      e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    });
    return e;
  }

  let toastTimer = null;
  function toast(msg, bad) {
    let t = document.getElementById("toast");
    if (!t) {
      t = el("div", { class: "toast", id: "toast" });
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.className = "toast show" + (bad ? " bad" : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = "toast" + (bad ? " bad" : ""); }, 2600);
  }

  /* ---------------------------------------------------------- navigation */
  const LINKS = [
    ["bills.html", "bills", "Upload bill"],
    ["predict.html", "predict", "Predict"],
    ["appliances.html", "appliances", "Appliances"],
    ["tariff.html", "tariff", "Tariff"],
    ["summary.html", "summary", "Summary"],
    ["history.html", "history", "History"],
  ];

  async function logout() {
    try { await api("POST", "/api/logout", {}); } catch (e) { /* ignore */ }
    location.href = "index.html";
  }

  function renderNav(user, active) {
    const host = document.getElementById("nav");
    if (!host) return;
    const links = LINKS.slice();
    if (user.role === "admin") links.push(["admin.html", "admin", "Admin"]);

    const nav = el("header", { class: "nav" },
      el("div", { class: "container nav-inner" },
        el("a", { class: "brand", href: user.role === "admin" ? "admin.html" : "bills.html" },
          el("span", { class: "bolt", text: "⚡" }), " PowerWise"),
        el("nav", { class: "nav-links", id: "navLinks" },
          links.map(function (l) {
            return el("a", { href: l[0], class: l[1] === active ? "active" : "" }, l[2]);
          })),
        el("div", { class: "nav-user" },
          el("span", {}, "Hi, ", el("strong", { text: user.name })),
          el("button", { class: "btn btn-ghost btn-sm", type: "button", onclick: logout }, "Logout")),
        el("button", {
          class: "nav-toggle", type: "button", "aria-label": "Menu",
          onclick: function () {
            nav.classList.toggle("open");
            const h = document.getElementById("navLinks").offsetHeight;
            nav.style.setProperty("--links-h", h + "px");
          },
        }, "☰")));
    host.replaceWith(nav);

    const foot = document.getElementById("foot");
    if (foot) {
      foot.replaceWith(el("footer", { class: "footer" },
        el("div", { class: "container" },
          "PowerWise – Electricity Usage Predictor. Predictions are estimates from a simple trend; your real bill depends on your provider's tariff.")));
    }
  }

  async function init(active, opts) {
    opts = opts || {};
    let me;
    try {
      me = await api("GET", "/api/me");
    } catch (e) {
      if (e.status === 401) { location.replace("index.html"); return null; }
      showOffline();
      return null;
    }
    if (opts.admin && me.user.role !== "admin") { location.replace("bills.html"); return null; }
    renderNav(me.user, active);
    refreshTheme();
    return me.user;
  }

  /* -------------------------------------------------------------- profile */
  function normalizeProfile(p) {
    p = p || {};
    const units = Array.isArray(p.units) && p.units.length === 6 ? p.units.slice() : ["", "", "", "", "", ""];
    return {
      units: units,
      appliances: Array.isArray(p.appliances) ? p.appliances : STARTER_APPLIANCES.map(function (a) { return Object.assign({}, a); }),
      tariff: Object.assign({}, DEFAULT_TARIFF, p.tariff || {}),
      lastPrediction: p.lastPrediction || null,
      lastAppliance: p.lastAppliance || null,
      bills: Array.isArray(p.bills) ? p.bills : [],
      hasTariff: !!p.tariff,
    };
  }

  async function loadProfile() {
    const d = await api("GET", "/api/profile");
    const p = normalizeProfile(d.profile);
    p.logins = d.logins;
    p.lastLogin = d.lastLogin;
    p.created = d.created;
    return p;
  }

  /* --------------------------------------------------------- calculations */
  function monthLabels() {
    // the last 6 monthly bills you already have, plus the upcoming one (this month)
    const now = new Date();
    const past = [], pastKeys = [];
    for (let i = 6; i >= 1; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      past.push(MONTHS[d.getMonth()] + " " + String(d.getFullYear()).slice(2));
      pastKeys.push(d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"));
    }
    const nx = new Date(now.getFullYear(), now.getMonth(), 1);
    return {
      past: past, pastKeys: pastKeys,
      next: MONTHS[nx.getMonth()] + " " + String(nx.getFullYear()).slice(2),
      nextKey: nx.getFullYear() + "-" + String(nx.getMonth() + 1).padStart(2, "0"),
    };
  }

  function linearRegression(ys) {
    const n = ys.length;
    let sx = 0, sy = 0, sxy = 0, sxx = 0;
    for (let i = 0; i < n; i++) { sx += i; sy += ys[i]; sxy += i * ys[i]; sxx += i * i; }
    const denom = n * sxx - sx * sx;
    const slope = denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
    return { slope: slope, intercept: (sy - slope * sx) / n };
  }

  function calcBill(units, t) {
    units = Math.max(0, Number(units) || 0);
    const caps = [Number(t.s1), Number(t.s2), Infinity];
    const rates = [Number(t.r1), Number(t.r2), Number(t.r3)];
    let prev = 0, energy = 0;
    const lines = [];
    for (let i = 0; i < 3; i++) {
      const inSlab = Math.max(0, Math.min(units, caps[i]) - prev);
      if (inSlab > 0) {
        const amt = inSlab * rates[i];
        energy += amt;
        lines.push({ label: inSlab.toFixed(0) + " units × ₹" + rates[i].toFixed(2), amount: amt });
      }
      prev = Math.max(prev, caps[i]);
      if (units <= caps[i]) break;
    }
    const fixed = Number(t.fixed);
    const duty = ((energy + fixed) * Number(t.duty)) / 100;
    return { lines: lines, energy: energy, fixed: fixed, duty: duty, total: energy + fixed + duty };
  }

  function marginalRate(units, t) {
    if (units <= t.s1) return { slab: 1, rate: Number(t.r1) };
    if (units <= t.s2) return { slab: 2, rate: Number(t.r2) };
    return { slab: 3, rate: Number(t.r3) };
  }

  function applKwh(a) {
    return ((Number(a.watts) || 0) * (Number(a.hours) || 0) * (Number(a.qty) || 0) * 30) / 1000;
  }
  function applTotal(list) {
    return list.reduce(function (s, a) { return s + applKwh(a); }, 0);
  }

  function keyLabel(key) {
    const p = String(key).split("-");
    return p.length === 2 ? MONTHS[Number(p[1]) - 1] + " " + p[0].slice(2) : String(key);
  }

  function inr(n) { return "₹" + Math.round(n).toLocaleString("en-IN"); }

  function fmtDate(ts) {
    if (!ts) return "–";
    return new Date(ts * 1000).toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
  }

  function renderBreakdown(box, bill) {
    box.textContent = "";
    function add(label, amount, cls) {
      box.appendChild(el("div", { class: cls || "" }, el("span", { text: label }), el("span", { text: inr(amount) })));
    }
    bill.lines.forEach(function (l) { add(l.label, l.amount); });
    add("Fixed charge", bill.fixed);
    add("Duty / tax", bill.duty);
    add("Total", bill.total, "total");
  }

  /* ---------------------------------------------------------------- chart */
  function drawBarChart(canvas, o) {
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 600;
    const cssH = o.height || 320;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.height = cssH + "px";
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const cs = getComputedStyle(document.documentElement);
    const css = function (n) { return cs.getPropertyValue(n).trim(); };
    const font = "Segoe UI, Arial, sans-serif";

    const values = o.values || [];
    if (!values.length) {
      ctx.fillStyle = css("--muted");
      ctx.font = "15px " + font;
      ctx.textAlign = "center";
      ctx.fillText(o.empty || "No data yet", cssW / 2, cssH / 2);
      return;
    }

    const pad = { top: 22, right: 14, bottom: 46, left: 46 };
    const w = cssW - pad.left - pad.right;
    const h = cssH - pad.top - pad.bottom;
    const maxV = Math.max.apply(null, values.concat([10])) * 1.15;

    ctx.strokeStyle = css("--border");
    ctx.fillStyle = css("--muted");
    ctx.font = "12px " + font;
    ctx.textAlign = "right";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + h - (h * i) / 4;
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + w, y); ctx.stroke();
      ctx.fillText(String(Math.round((maxV * i) / 4)), pad.left - 8, y + 4);
    }

    const slot = w / values.length;
    const barW = Math.min(58, slot * 0.6);
    values.forEach(function (v, i) {
      const x = pad.left + slot * i + (slot - barW) / 2;
      const bh = (v / maxV) * h;
      const y = pad.top + h - bh;
      let color = css("--soft");
      if (o.colors && o.colors[i]) color = o.colors[i] === "accent" ? css("--accent") : o.colors[i] === "primary" ? css("--primary") : css("--soft");
      else if (o.highlightLast && i === values.length - 1) color = css("--accent");
      ctx.fillStyle = color;
      ctx.fillRect(x, y, barW, bh);

      ctx.fillStyle = css("--text");
      ctx.textAlign = "center";
      ctx.font = "600 12px " + font;
      ctx.fillText(String(Math.round(v)), x + barW / 2, y - 6);

      ctx.fillStyle = css("--muted");
      ctx.font = "12px " + font;
      const words = String(o.labels[i]).split(" ");
      const lines = words.length > 2 ? [words.slice(0, 2).join(" "), words.slice(2).join(" ")] : [o.labels[i]];
      lines.forEach(function (ln, k) { ctx.fillText(ln, x + barW / 2, pad.top + h + 18 + k * 14); });
    });

    if (o.trend) {
      ctx.strokeStyle = css("--primary-dark");
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      for (let i = 0; i < values.length; i++) {
        const v = o.trend.intercept + o.trend.slope * i;
        const x = pad.left + slot * i + slot / 2;
        const y = pad.top + h - (Math.max(0, v) / maxV) * h;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  /* --------------------------------------------------------------- export */
  global.PW = {
    DEFAULT_THEME: DEFAULT_THEME,
    DEFAULT_TARIFF: DEFAULT_TARIFF,
    PRESETS: PRESETS,
    STARTER_APPLIANCES: STARTER_APPLIANCES,
    api: api,
    el: el,
    toast: toast,
    init: init,
    showOffline: showOffline,
    refreshTheme: refreshTheme,
    applyTheme: applyTheme,
    cacheTheme: cacheTheme,
    loadProfile: loadProfile,
    monthLabels: monthLabels,
    linearRegression: linearRegression,
    calcBill: calcBill,
    marginalRate: marginalRate,
    applKwh: applKwh,
    applTotal: applTotal,
    inr: inr,
    keyLabel: keyLabel,
    fmtDate: fmtDate,
    renderBreakdown: renderBreakdown,
    drawBarChart: drawBarChart,
    logout: logout,
  };
})(window);
