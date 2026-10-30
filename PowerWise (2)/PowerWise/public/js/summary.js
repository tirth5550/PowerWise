(async function () {
  "use strict";
  const $ = function (s) { return document.querySelector(s); };
  const el = PW.el;

  const user = await PW.init("summary");
  if (!user) return;

  let profile;
  try { profile = await PW.loadProfile(); } catch (e) { PW.showOffline(); return; }

  const t = profile.tariff;
  const labels = PW.monthLabels();

  // forecast: recomputed from the saved monthly units with the CURRENT tariff
  let forecast = null;
  const unitNums = profile.units.map(function (v) { return v === "" || v === null ? NaN : Number(v); });
  if (!unitNums.some(Number.isNaN)) {
    const reg = PW.linearRegression(unitNums);
    const units = Math.max(0, reg.intercept + reg.slope * 6);
    forecast = { units: units, bill: PW.calcBill(units, t), ys: unitNums, last: unitNums[5] };
  }

  // appliance estimate: only once the user has saved it
  let appl = null;
  if (profile.lastAppliance) {
    const units = PW.applTotal(profile.appliances);
    appl = { units: units, bill: PW.calcBill(units, t) };
  }

  /* ---- missing-data notice */
  const miss = [];
  if (!forecast) miss.push(el("span", {}, "Past-usage forecast is missing. ", el("a", { href: "predict.html" }, "Do Step 1"), ". "));
  if (!appl) miss.push(el("span", {}, "Appliance estimate is missing. ", el("a", { href: "appliances.html" }, "Do Step 2"), "."));
  if (miss.length) { $("#missing").hidden = false; $("#missing").append.apply($("#missing"), miss); }

  /* ---- top cards */
  function card(label, value, unit, cls) {
    return el("div", { class: "card big-card" },
      el("span", { class: "stat-label", text: label }),
      el("div", {}, el("span", { class: "stat-value " + (cls || ""), text: value })),
      el("span", { class: "stat-unit", text: unit }));
  }
  const dash = "–";
  const cards = $("#topCards");
  cards.append(
    card("Forecast for " + labels.next, forecast ? Math.round(forecast.units) + " kWh" : dash,
      forecast ? PW.inr(forecast.bill.total) + " estimated bill" : "Step 1 not done"),
    card("Appliance estimate", appl ? Math.round(appl.units) + " kWh" : dash,
      appl ? PW.inr(appl.bill.total) + " estimated bill" : "Step 2 not done")
  );
  if (forecast && appl) {
    const du = appl.units - forecast.units;
    const db = appl.bill.total - forecast.bill.total;
    const pct = forecast.units === 0 ? 0 : (du / forecast.units) * 100;
    cards.append(card("Difference (appliance − forecast)",
      (du >= 0 ? "+" : "−") + Math.abs(Math.round(du)) + " kWh",
      (db >= 0 ? "+" : "−") + PW.inr(Math.abs(db)) + " (" + (pct >= 0 ? "+" : "") + pct.toFixed(0) + "%)",
      Math.abs(pct) < 10 ? "down" : ""));
  } else {
    cards.append(card("Difference", dash, "Needs both steps"));
  }

  /* ---- breakdowns */
  $("#fcLabel").textContent = forecast ? "(" + labels.next + ")" : "";
  if (forecast) PW.renderBreakdown($("#fcBreakdown"), forecast.bill); else $("#fcEmpty").hidden = false;
  if (appl) PW.renderBreakdown($("#apBreakdown"), appl.bill); else $("#apEmpty").hidden = false;

  /* ---- chart */
  function drawChart() {
    const lab = [], val = [], col = [];
    if (forecast) { lab.push("Last bill (" + labels.past[5] + ")"); val.push(forecast.last); col.push("soft"); }
    if (forecast) { lab.push("Forecast"); val.push(forecast.units); col.push("accent"); }
    if (appl) { lab.push("Appliance estimate"); val.push(appl.units); col.push("primary"); }
    PW.drawBarChart($("#chart"), {
      labels: lab, values: val, colors: col, height: 300,
      empty: "Complete Step 1 or Step 2 to see the comparison.",
    });
  }
  drawChart();
  window.addEventListener("resize", drawChart);

  /* ---- where electricity goes */
  const box = $("#topAppl");
  if (!appl) {
    box.append(el("p", { class: "muted", text: "Save your appliance estimate in Step 2 to see which appliances use the most." }));
  } else {
    const rows = profile.appliances.map(function (a) { return { name: a.name, kwh: PW.applKwh(a) }; })
      .sort(function (a, b) { return b.kwh - a.kwh; }).slice(0, 6);
    const total = appl.units || 1;
    if (!rows.length) box.append(el("p", { class: "muted", text: "No appliances in your list." }));
    rows.forEach(function (r) {
      const pct = (r.kwh / total) * 100;
      box.append(el("div", { class: "hbar" },
        el("div", { class: "hbar-top" },
          el("span", { text: r.name }),
          el("span", { class: "muted", text: r.kwh.toFixed(0) + " kWh · " + pct.toFixed(0) + "%" })),
        el("div", { class: "hbar-track" }, el("div", { class: "hbar-fill", style: "width:" + Math.min(100, pct) + "%" }))));
    });
  }

  /* ---- insights */
  const ins = $("#insights");
  function add(text) { ins.append(el("li", { text: text })); }

  if (forecast) {
    const ch = forecast.last === 0 ? 0 : ((forecast.units - forecast.last) / forecast.last) * 100;
    add("Your next bill is expected around " + PW.inr(forecast.bill.total) + " for about " + Math.round(forecast.units) +
      " kWh, " + Math.abs(ch).toFixed(0) + "% " + (ch >= 0 ? "more" : "less") + " than your last bill.");
    add("If every month looked like this, a year would cost roughly " + PW.inr(forecast.bill.total * 12) + ".");
    const m = PW.marginalRate(forecast.units, t);
    add("Your last units are billed in slab " + m.slab + " at ₹" + m.rate.toFixed(2) + " per unit before duty.");
    const cut = Math.min(20, forecast.units);
    const saved = forecast.bill.total - PW.calcBill(forecast.units - cut, t).total;
    if (cut > 0) add("Using " + cut.toFixed(0) + " fewer units would save you about " + PW.inr(saved) + " on that bill.");
  }
  if (forecast && appl) {
    const share = forecast.units === 0 ? 0 : (appl.units / forecast.units) * 100;
    if (share < 90) {
      add("Your appliance list explains " + share.toFixed(0) + "% of the forecast. About " + Math.round(forecast.units - appl.units) +
        " kWh comes from things not listed or used longer than entered (AC, geyser, pump?).");
    } else if (share <= 110) {
      add("Your appliance list matches the forecast closely (" + share.toFixed(0) + "%). Both methods agree.");
    } else {
      add("Your appliance list is " + (share - 100).toFixed(0) + "% above the forecast. Some appliances probably run fewer hours than entered.");
    }
  }
  if (!ins.children.length) add("Complete Step 1 and Step 2 to get personal insights here.");

  /* ---- tariff box */
  const tb = $("#tariffBox");
  function trow(a, b) { tb.append(el("div", {}, el("span", { text: a }), el("span", { text: b }))); }
  trow("Slab 1: up to " + t.s1 + " units", "₹" + t.r1 + " / unit");
  trow("Slab 2: up to " + t.s2 + " units", "₹" + t.r2 + " / unit");
  trow("Above " + t.s2 + " units", "₹" + t.r3 + " / unit");
  trow("Fixed charge", "₹" + t.fixed + " / month");
  trow("Duty / tax", t.duty + "%");
  if (!profile.hasTariff) {
    tb.after(el("p", { class: "muted", style: "margin-top:10px" },
      "These are the sample rates. ", el("a", { href: "tariff.html" }, "Enter your own rates"), " for accurate numbers."));
  }
})();
