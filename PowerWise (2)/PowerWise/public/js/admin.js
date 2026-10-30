(async function () {
  "use strict";
  const $ = function (s) { return document.querySelector(s); };
  const el = PW.el;

  const user = await PW.init("admin", { admin: true });
  if (!user) return;

  const KEYS = ["primary", "accent", "bg", "hero1", "hero2"];
  const LOOKS = [
    { name: "Forest green", primary: "#1f9d55", accent: "#f5a800", bg: "#f6f8f5", hero1: "#e3f6e9", hero2: "#fff7dc" },
    { name: "Ocean blue", primary: "#1c7ed6", accent: "#ffb703", bg: "#f4f8fc", hero1: "#dbeafe", hero2: "#e0f2fe" },
    { name: "Royal purple", primary: "#7048e8", accent: "#fcc419", bg: "#f8f6fd", hero1: "#ede7fd", hero2: "#fdf3d6" },
    { name: "Sunset orange", primary: "#e8590c", accent: "#ffd43b", bg: "#fdf8f3", hero1: "#ffe8d6", hero2: "#fff3bf" },
    { name: "Rose", primary: "#d6336c", accent: "#fab005", bg: "#fdf5f8", hero1: "#ffdeeb", hero2: "#fff0f6" },
    { name: "Teal", primary: "#0c8599", accent: "#f59f00", bg: "#f3f9fa", hero1: "#c5f6fa", hero2: "#e3fafc" },
    { name: "Midnight (dark)", primary: "#3ddc84", accent: "#ffc857", bg: "#0f1a14", hero1: "#12261b", hero2: "#2a2410" },
  ];

  let saved = Object.assign({}, PW.DEFAULT_THEME);
  let draft = Object.assign({}, PW.DEFAULT_THEME);
  let stats = null;

  /* ------------------------------------------------------------ stats */
  function statCard(label, value, unit) {
    return el("div", { class: "card big-card" },
      el("span", { class: "stat-label", text: label }),
      el("div", {}, el("span", { class: "stat-value", text: String(value) })),
      el("span", { class: "stat-unit", text: unit }));
  }

  function renderStats() {
    const s = stats;
    const box = $("#stats");
    box.textContent = "";
    box.append(
      statCard("Registered users", s.totalUsers, "people with an account"),
      statCard("Total logins", s.totalLogins, "all time"),
      statCard("Logins today", s.loginsToday, "since midnight"),
      statCard("Online now", s.onlineNow, "active sessions"),
      statCard("Data added", s.totalEntries, "saved entries by everyone")
    );
    $("#pwWarn").hidden = !s.defaultPassword;
    $("#updated").textContent = "Updated " + new Date().toLocaleTimeString("en-IN");

    // chart
    PW.drawBarChart($("#chart"), {
      labels: s.days.map(function (d) { return d.label; }),
      values: s.days.map(function (d) { return d.count; }),
      highlightLast: true, height: 260, empty: "No logins yet",
    });

    // recent logins
    const rec = $("#recent");
    rec.textContent = "";
    if (!s.recent.length) rec.append(el("tr", {}, el("td", { colspan: "2", class: "empty", text: "No logins yet" })));
    s.recent.slice(0, 10).forEach(function (r) {
      rec.append(el("tr", {},
        el("td", {}, el("strong", { text: r.name }), " ", el("span", { class: "muted", text: "@" + r.username })),
        el("td", { text: PW.fmtDate(r.ts), style: "white-space:nowrap" })));
    });

    // users
    const body = $("#users");
    body.textContent = "";
    s.users.forEach(function (u) {
      body.append(el("tr", {},
        el("td", {}, el("strong", { text: u.name })),
        el("td", { class: "muted", text: "@" + u.username }),
        el("td", { text: String(u.logins) }),
        el("td", { text: String(u.entries) }),
        el("td", { text: PW.fmtDate(u.lastLogin), style: "white-space:nowrap" }),
        el("td", { text: PW.fmtDate(u.created), style: "white-space:nowrap" }),
        el("td", {},
          u.role === "admin" ? el("span", { class: "badge accent", text: "Admin" }) : null,
          u.online ? el("span", { class: "badge live", text: "Online" }) : (u.role === "admin" ? null : el("span", { class: "badge gray", text: "Offline" }))),
        el("td", {}, u.role === "admin" ? null : el("button", {
          class: "btn btn-danger btn-sm", type: "button",
          onclick: async function () {
            if (!confirm("Delete " + u.name + " (@" + u.username + ") and all their saved data?")) return;
            try { await PW.api("DELETE", "/api/admin/users/" + encodeURIComponent(u.username)); PW.toast("User deleted"); load(); }
            catch (e) { PW.toast(e.message, true); }
          },
        }, "Delete"))));
    });
  }

  async function load() {
    try {
      stats = await PW.api("GET", "/api/admin/stats");
      saved = Object.assign({}, PW.DEFAULT_THEME, stats.theme);
      renderStats();
    } catch (e) {
      if (e.message === "SERVER_OFFLINE") PW.showOffline(); else PW.toast(e.message, true);
    }
  }

  /* ------------------------------------------------------------ theme */
  function syncInputs() { KEYS.forEach(function (k) { $("#c_" + k).value = draft[k]; }); }

  function preview() {
    PW.applyTheme(draft);
    if (stats) renderStats();
  }

  const sw = $("#swatches");
  LOOKS.forEach(function (l) {
    sw.append(el("button", {
      class: "swatch", type: "button",
      onclick: function () { draft = Object.assign({}, l); delete draft.name; syncInputs(); preview(); $("#themeMsg").textContent = ""; },
    }, el("i", { style: "background:" + l.primary }), l.name));
  });

  KEYS.forEach(function (k) {
    $("#c_" + k).addEventListener("input", function (e) { draft[k] = e.target.value; preview(); $("#themeMsg").textContent = ""; });
  });

  $("#btnSaveTheme").addEventListener("click", async function () {
    try {
      const d = await PW.api("PUT", "/api/admin/theme", draft);
      saved = d.theme; draft = Object.assign({}, saved);
      PW.cacheTheme(saved);
      $("#themeMsg").textContent = "Saved. Everyone will see the new colours.";
    } catch (e) { PW.toast(e.message, true); }
  });

  $("#btnResetTheme").addEventListener("click", async function () {
    try {
      const d = await PW.api("DELETE", "/api/admin/theme");
      saved = d.theme; draft = Object.assign({}, saved);
      PW.cacheTheme(saved);
      syncInputs(); preview();
      $("#themeMsg").textContent = "Original colours restored.";
    } catch (e) { PW.toast(e.message, true); }
  });

  /* --------------------------------------------------------- password */
  $("#pwForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    const msg = $("#pwMsg");
    msg.className = "error"; msg.textContent = "";
    try {
      await PW.api("POST", "/api/password", { old: $("#pw_old").value, new: $("#pw_new").value });
      msg.className = "ok-msg"; msg.textContent = "Password changed.";
      $("#pwForm").reset();
      load();
    } catch (err) { msg.textContent = err.message; }
  });

  $("#btnRefresh").addEventListener("click", load);
  window.addEventListener("resize", function () { if (stats) renderStats(); });

  await load();
  draft = Object.assign({}, saved);
  syncInputs();
  setInterval(function () { if (!document.hidden) load(); }, 20000);
})();
