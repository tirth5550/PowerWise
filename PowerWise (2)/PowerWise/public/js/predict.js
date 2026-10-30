(async function () {
  "use strict";
  const $ = function (s) { return document.querySelector(s); };

  const user = await PW.init("predict");
  if (!user) return;

  let profile;
  try { profile = await PW.loadProfile(); } catch (e) { PW.showOffline(); return; }

  const SAMPLE = [210, 235, 280, 340, 365, 330];
  const labels = PW.monthLabels();
  const units = profile.units.slice();
  const fromBill = [false, false, false, false, false, false];
  let last = null;

  // months we already know from uploaded bills
  const billUnits = {};
  profile.bills.forEach(function (b) { billUnits[b.monthKey] = b.units; });

  function fillFromBills(overwrite) {
    let n = 0;
    labels.pastKeys.forEach(function (key, i) {
      if (billUnits[key] === undefined) return;
      if (overwrite || units[i] === "" || units[i] === null) {
        units[i] = String(billUnits[key]);
        fromBill[i] = true;
        n++;
      } else if (Number(units[i]) === billUnits[key]) {
        fromBill[i] = true;
      }
    });
    return n;
  }

  function renderBillNote() {
    const box = $("#billNote");
    const known = labels.pastKeys.filter(function (k) { return billUnits[k] !== undefined; }).length;
    box.textContent = "";
    if (!known) {
      box.hidden = false;
      box.append(
        "Tip: you do not have to type all 6 months. ",
        PW.el("a", { href: "bills.html" }, "Upload your bills"),
        " and PowerWise fills the units for you."
      );
      return;
    }
    const mismatch = labels.pastKeys.some(function (k, i) {
      return billUnits[k] !== undefined && Number(units[i]) !== billUnits[k];
    });
    box.hidden = false;
    box.append(
      known + " of 6 months were filled from your uploaded bills (marked with a green edge). ",
      mismatch ? PW.el("a", { href: "#", onclick: function (e) { e.preventDefault(); fillFromBills(true); buildInputs(); renderBillNote(); } }, "Use the bill values for all of them") : "",
      mismatch ? " \u00B7 " : "",
      PW.el("a", { href: "bills.html" }, known < 6 ? "Upload more bills" : "Manage bills")
    );
  }

  $("#intro").textContent =
    "Enter the units (kWh) printed on your last 6 monthly bills (" + labels.past[0] + " to " + labels.past[5] +
    "), oldest first. PowerWise predicts the upcoming bill for " + labels.next + ".";
  $("#nextMonthLabel").textContent = labels.next;

  function buildInputs() {
    const wrap = $("#historyInputs");
    wrap.textContent = "";
    labels.past.forEach(function (label, i) {
      const inp = PW.el("input", { type: "number", min: "0", step: "1", placeholder: "kWh", inputmode: "decimal" });
      inp.value = units[i];
      if (fromBill[i]) inp.classList.add("from-bill");
      inp.addEventListener("input", function () { units[i] = inp.value; inp.classList.remove("from-bill"); });
      wrap.appendChild(PW.el("label", { class: "field" }, label, inp));
    });
  }

  function read() {
    const vals = units.map(function (v) { return v === "" || v === null ? NaN : Number(v); });
    if (vals.some(Number.isNaN)) return { error: "Please fill all 6 months with unit values." };
    if (vals.some(function (v) { return v < 0; })) return { error: "Units cannot be negative." };
    return { values: vals };
  }

  function compute(ys) {
    const reg = PW.linearRegression(ys);
    const predicted = Math.max(0, reg.intercept + reg.slope * ys.length);
    const lastVal = ys[ys.length - 1];
    const change = lastVal === 0 ? 0 : ((predicted - lastVal) / lastVal) * 100;
    return { ys: ys, reg: reg, predicted: predicted, change: change, bill: PW.calcBill(predicted, profile.tariff) };
  }

  function render(r) {
    last = r;
    $("#predUnits").textContent = Math.round(r.predicted);
    $("#predBill").textContent = PW.inr(r.bill.total);
    const t = $("#predTrend");
    t.textContent = (r.change >= 0 ? "+" : "") + r.change.toFixed(1) + "%";
    t.className = "stat-value " + (r.change > 0 ? "up" : "down");
    $("#predTrendNote").textContent = r.change > 0 ? "higher than last month" : "lower than last month";
    PW.renderBreakdown($("#billBreakdown"), r.bill);
    drawChart();
  }

  function drawChart() {
    if (!last) {
      PW.drawBarChart($("#chart"), { values: [], empty: "Enter your monthly units and press “Predict & save”." });
      return;
    }
    PW.drawBarChart($("#chart"), {
      labels: labels.past.concat(labels.next),
      values: last.ys.concat(last.predicted),
      highlightLast: true,
      trend: last.reg,
    });
  }

  function clearResult() {
    last = null;
    $("#predUnits").textContent = "–";
    $("#predBill").textContent = "–";
    $("#predTrend").textContent = "–";
    $("#predTrend").className = "stat-value";
    $("#billBreakdown").textContent = "";
    drawChart();
  }

  async function predictAndSave() {
    const err = $("#formError");
    err.textContent = "";
    const res = read();
    if (res.error) { err.textContent = res.error; return; }
    const r = compute(res.values);
    render(r);
    try {
      await PW.api("PUT", "/api/profile", {
        units: units,
        lastPrediction: { units: r.predicted, bill: r.bill.total, trend: r.change, month: labels.next },
        log: {
          type: "predict",
          summary: "Predicted " + Math.round(r.predicted) + " kWh (" + PW.inr(r.bill.total) + ") for " + labels.next,
          detail: "Past units: " + res.values.join(", "),
        },
      });
      PW.toast("Saved to your history");
    } catch (e) {
      PW.toast(e.message === "SERVER_OFFLINE" ? "Server is not running" : e.message, true);
    }
  }

  $("#btnPredict").addEventListener("click", predictAndSave);
  $("#btnSample").addEventListener("click", function () {
    SAMPLE.forEach(function (v, i) { units[i] = String(v); });
    buildInputs();
    predictAndSave();
  });
  $("#btnReset").addEventListener("click", async function () {
    for (let i = 0; i < 6; i++) units[i] = "";
    buildInputs();
    clearResult();
    $("#formError").textContent = "";
    try { await PW.api("PUT", "/api/profile", { units: units, lastPrediction: null }); } catch (e) { /* ignore */ }
  });
  window.addEventListener("resize", drawChart);

  fillFromBills(false);
  renderBillNote();
  buildInputs();
  const first = read();
  if (first.values) render(compute(first.values)); else drawChart();
})();
