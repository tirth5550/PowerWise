(async function () {
  "use strict";
  const $ = function (s) { return document.querySelector(s); };

  const user = await PW.init("appliances");
  if (!user) return;

  let profile;
  try { profile = await PW.loadProfile(); } catch (e) { PW.showOffline(); return; }

  const list = profile.appliances.map(function (a) { return Object.assign({}, a); });
  let dirty = !profile.lastAppliance; // starter list is not saved until the user saves it

  function setDirty(v) {
    dirty = v;
    $("#dirty").hidden = !dirty;
  }

  function buildPresets() {
    const sel = $("#applPreset");
    PW.PRESETS.forEach(function (p, i) {
      sel.appendChild(PW.el("option", { value: String(i), text: p.name + " (" + p.watts + " W)" }));
    });
    sel.appendChild(PW.el("option", { value: "custom", text: "Custom appliance…" }));
  }

  function updateTotals() {
    const units = PW.applTotal(list);
    $("#applUnits").textContent = units.toFixed(0);
    $("#applBill").textContent = PW.inr(PW.calcBill(units, profile.tariff).total);
    compare(units);
  }

  function compare(units) {
    const note = $("#compareNote");
    const p = profile.lastPrediction;
    if (!p) { note.textContent = "Tip: run the forecast in Step 1 to compare it with this estimate."; return; }
    const diff = units - p.units;
    const pct = p.units === 0 ? 0 : (Math.abs(diff) / p.units) * 100;
    if (pct < 10) note.textContent = "Close to your forecast of " + Math.round(p.units) + " kWh. Your appliance list looks realistic.";
    else if (diff > 0) note.textContent = "About " + pct.toFixed(0) + "% higher than your forecast of " + Math.round(p.units) + " kWh. Some appliances may run fewer hours than entered.";
    else note.textContent = "About " + pct.toFixed(0) + "% lower than your forecast of " + Math.round(p.units) + " kWh. Some appliances may be missing from the list.";
  }

  function render() {
    const tbody = $("#applTable tbody");
    tbody.textContent = "";
    if (!list.length) {
      tbody.appendChild(PW.el("tr", {}, PW.el("td", { colspan: "6", class: "empty", text: "No appliances yet. Add one from the list above." })));
    }
    list.forEach(function (a, idx) {
      const kwh = PW.el("td", { text: PW.applKwh(a).toFixed(1) });
      function input(type, key, step) {
        const inp = PW.el("input", { type: type, "aria-label": key });
        if (type === "number") { inp.min = "0"; inp.step = step || "1"; }
        inp.value = a[key];
        inp.addEventListener("input", function () {
          a[key] = type === "number" ? (inp.value === "" ? 0 : Number(inp.value)) : inp.value;
          kwh.textContent = PW.applKwh(a).toFixed(1);
          setDirty(true);
          updateTotals();
        });
        return PW.el("td", {}, inp);
      }
      tbody.appendChild(PW.el("tr", {},
        input("text", "name"),
        input("number", "watts"),
        input("number", "hours", "0.5"),
        input("number", "qty"),
        kwh,
        PW.el("td", {}, PW.el("button", {
          class: "btn-del", type: "button", title: "Remove",
          onclick: function () { list.splice(idx, 1); setDirty(true); render(); },
        }, "✕"))));
    });
    updateTotals();
  }

  $("#btnAddAppl").addEventListener("click", function () {
    const v = $("#applPreset").value;
    if (v === "custom") list.push({ name: "My appliance", watts: 100, hours: 1, qty: 1 });
    else {
      const p = PW.PRESETS[Number(v)];
      list.push({ name: p.name, watts: p.watts, hours: p.hours, qty: 1 });
    }
    setDirty(true);
    render();
  });

  $("#btnSave").addEventListener("click", async function () {
    const units = PW.applTotal(list);
    const bill = PW.calcBill(units, profile.tariff).total;
    const top = list.slice().sort(function (a, b) { return PW.applKwh(b) - PW.applKwh(a); })
      .slice(0, 3).map(function (a) { return a.name + " " + PW.applKwh(a).toFixed(0) + " kWh"; }).join(", ");
    try {
      const res = await PW.api("PUT", "/api/profile", {
        appliances: list,
        lastAppliance: { units: units, bill: bill },
        log: {
          type: "appliances",
          summary: "Appliance estimate " + Math.round(units) + " kWh (" + PW.inr(bill) + ") from " + list.length + " appliance" + (list.length === 1 ? "" : "s"),
          detail: top ? "Biggest: " + top : "",
        },
      });
      profile.lastAppliance = res.profile.lastAppliance;
      setDirty(false);
      PW.toast("Saved to your history");
    } catch (e) {
      PW.toast(e.message === "SERVER_OFFLINE" ? "Server is not running" : e.message, true);
    }
  });

  buildPresets();
  render();
  setDirty(dirty);
})();
