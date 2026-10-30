(async function () {
  "use strict";
  const $ = function (s) { return document.querySelector(s); };
  const el = PW.el;

  const user = await PW.init("history");
  if (!user) return;

  const TYPES = {
    bill: { label: "Bill", cls: "" },
    predict: { label: "Prediction", cls: "" },
    appliances: { label: "Appliances", cls: "accent" },
    tariff: { label: "Tariff", cls: "gray" },
  };

  let data = null;

  async function load() {
    try {
      data = await PW.api("GET", "/api/history");
    } catch (e) {
      if (e.message === "SERVER_OFFLINE") PW.showOffline();
      return;
    }
    renderCounts();
    renderRows();
  }

  function stat(label, value, unit) {
    return el("div", { class: "card big-card" },
      el("span", { class: "stat-label", text: label }),
      el("div", {}, el("span", { class: "stat-value", text: String(value) })),
      el("span", { class: "stat-unit", text: unit }));
  }

  function renderCounts() {
    const c = data.counts;
    const box = $("#counts");
    box.textContent = "";
    box.append(
      stat("Times data added", c.total, "in total"),
      stat("Bills uploaded", c.bill, "saved from photos, PDFs or typed"),
      stat("Predictions", c.predict, "past-usage forecasts"),
      stat("Appliance estimates", c.appliances, "saved"),
      stat("Tariff updates", c.tariff, "saved"),
      stat("Times logged in", data.logins, data.lastLogin ? "last: " + PW.fmtDate(data.lastLogin) : "")
    );
  }

  function renderRows() {
    const f = $("#filter").value;
    const list = data.entries.filter(function (e) { return f === "all" || e.type === f; });
    const body = $("#rows");
    body.textContent = "";
    if (!list.length) {
      body.append(el("tr", {}, el("td", { colspan: "5", class: "empty" },
        data.entries.length ? "Nothing of this type yet." : "No entries yet. Save a prediction, appliance estimate or tariff and it will show up here.")));
      return;
    }
    const total = data.entries.length;
    list.forEach(function (e) {
      const pos = data.entries.indexOf(e);
      const meta = TYPES[e.type] || { label: e.type, cls: "gray" };
      body.append(el("tr", {},
        el("td", { class: "muted", text: String(total - pos) }),
        el("td", {}, el("span", { class: "badge " + meta.cls, text: meta.label })),
        el("td", {},
          el("div", { text: e.summary }),
          e.detail ? el("div", { class: "muted", style: "font-size:.82rem", text: e.detail }) : null),
        el("td", { text: PW.fmtDate(e.ts), style: "white-space:nowrap" }),
        el("td", {}, el("button", {
          class: "btn-del", type: "button", title: "Delete this entry",
          onclick: async function () {
            try { await PW.api("DELETE", "/api/history/" + encodeURIComponent(e.id)); await load(); }
            catch (err) { PW.toast(err.message, true); }
          },
        }, "✕"))));
    });
  }

  $("#filter").addEventListener("change", renderRows);
  $("#btnClear").addEventListener("click", async function () {
    if (!data || !data.entries.length) return;
    if (!confirm("Delete all " + data.entries.length + " history entries? Your saved data stays.")) return;
    try { await PW.api("DELETE", "/api/history"); await load(); PW.toast("History cleared"); }
    catch (err) { PW.toast(err.message, true); }
  });

  load();
})();
