(async function () {
  "use strict";
  const $ = function (s) { return document.querySelector(s); };
  const FIELDS = ["s1", "r1", "s2", "r2", "r3", "fixed", "duty"];

  const user = await PW.init("tariff");
  if (!user) return;

  let profile;
  try { profile = await PW.loadProfile(); } catch (e) { PW.showOffline(); return; }

  function fill(t) { FIELDS.forEach(function (k) { $("#t_" + k).value = t[k]; }); }

  function readForm() {
    const t = {};
    for (let i = 0; i < FIELDS.length; i++) {
      const raw = $("#t_" + FIELDS[i]).value;
      const v = Number(raw);
      if (raw === "" || Number.isNaN(v) || v < 0) return { error: "Please enter valid, non-negative numbers in every field." };
      t[FIELDS[i]] = v;
    }
    if (t.s2 < t.s1) return { error: "Slab 2 limit must be greater than or equal to the slab 1 limit." };
    return { tariff: t };
  }

  function tryIt() {
    const r = readForm();
    const units = Number($("#tryUnits").value) || 0;
    if (r.error) { $("#tryBill").textContent = "–"; $("#tryAvg").textContent = "–"; $("#tryBreakdown").textContent = ""; return; }
    const bill = PW.calcBill(units, r.tariff);
    $("#tryBill").textContent = PW.inr(bill.total);
    $("#tryAvg").textContent = units > 0 ? "₹" + (bill.total / units).toFixed(2) : "–";
    PW.renderBreakdown($("#tryBreakdown"), bill);
  }

  FIELDS.forEach(function (k) { $("#t_" + k).addEventListener("input", tryIt); });
  $("#tryUnits").addEventListener("input", tryIt);

  $("#btnSaveTariff").addEventListener("click", async function () {
    $("#tariffError").textContent = "";
    const r = readForm();
    if (r.error) { $("#tariffError").textContent = r.error; return; }
    const t = r.tariff;
    try {
      await PW.api("PUT", "/api/profile", {
        tariff: t,
        log: {
          type: "tariff",
          summary: "Tariff updated: ₹" + t.r1 + " / ₹" + t.r2 + " / ₹" + t.r3 + " per unit",
          detail: "Slab 1 up to " + t.s1 + ", slab 2 up to " + t.s2 + ", fixed ₹" + t.fixed + ", duty " + t.duty + "%",
        },
      });
      profile.tariff = t;
      PW.toast("Tariff saved");
    } catch (e) {
      $("#tariffError").textContent = e.message === "SERVER_OFFLINE" ? "Server is not running." : e.message;
    }
  });

  $("#btnDefaultTariff").addEventListener("click", function () {
    fill(PW.DEFAULT_TARIFF);
    tryIt();
    PW.toast("Sample rates loaded. Press Save tariff to keep them.");
  });

  fill(profile.tariff);
  tryIt();
})();
