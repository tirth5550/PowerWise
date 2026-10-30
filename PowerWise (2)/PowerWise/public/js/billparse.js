/* Reads units, bill amount and billing period out of OCR text of an electricity bill.
 * Works in the browser (window.BillParse) and in Node (for testing). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.BillParse = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const MON_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

  // a number that is not part of a date like 30-09-2026 or 12/10
  const NUM = "([0-9][0-9,]*(?:\\.[0-9]+)?)(?![0-9]|[/-][0-9])";

  function toNum(s) {
    const n = parseFloat(String(s).replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }

  // a money token may contain several . or , (OCR often mixes them up): 1,538.13  1.538.13  1.53813
  const MONEY = "([0-9][0-9.,]*[0-9]|[0-9])(?![0-9]|[/-][0-9])";

  function fixMoney(raw) {
    const s = String(raw).replace(/[.,]+$/, "");
    if (/^[0-9,]+(?:\.[0-9]{1,2})?$/.test(s)) return parseFloat(s.replace(/,/g, ""));      // 1,538.13  1,23,456.00  1538.13
    let m = /^([0-9]+)[.,]([0-9]{1,2})$/.exec(s);                                          // 1538,13
    if (m) return parseFloat(m[1] + "." + m[2]);
    m = /^([0-9]{1,3})((?:[.,][0-9]{3})+)[.,]([0-9]{1,2})$/.exec(s);                      // 1.538.13  1.538,13
    if (m) return parseFloat(m[1] + m[2].replace(/[.,]/g, "") + "." + m[3]);
    m = /^([0-9]{1,3})((?:[.,][0-9]{3})+)$/.exec(s);                                       // 1.538
    if (m) return parseFloat(m[1] + m[2].replace(/[.,]/g, ""));
    m = /^([0-9]+)[.,]([0-9]{4,})$/.exec(s);                                               // 1.53813 -> 1538.13
    if (m) return parseFloat((m[1] + m[2]) / 100);
    return toNum(s);
  }

  function numbersIn(str) {
    const out = [];
    const re = new RegExp(NUM, "g");
    let m;
    while ((m = re.exec(str))) {
      const v = toNum(m[1]);
      if (v !== null) out.push(v);
    }
    return out;
  }

  // meter row: previous reading, current reading, (multiplying factor), units  ->  units = (current - previous) x factor
  function readingMatch(nums) {
    for (let i = 0; i < nums.length; i++) {
      for (let j = i + 1; j < nums.length; j++) {
        const a = nums[i], b = nums[j];
        if (!(b > a) || a < 10 || b - a > 100000) continue;
        for (let k = j + 1; k < nums.length; k++) {
          if (Math.abs(nums[k] - (b - a)) <= 0.5) return nums[k];
          for (let f = k + 1; f < nums.length; f++) {
            const mf = nums[k];
            if (mf >= 2 && mf <= 1000 && Math.abs(nums[f] - (b - a) * mf) <= 0.5) return nums[f];
          }
        }
      }
    }
    return null;
  }

  function monthIndex(name) {
    return MONTH_NAMES.indexOf(String(name).slice(0, 3).toLowerCase());
  }

  function pad(n) { return String(n).padStart(2, "0"); }
  function keyOf(y, m) { return y + "-" + pad(m + 1); }
  function labelOf(key) {
    const p = key.split("-");
    return MON_SHORT[Number(p[1]) - 1] + " " + p[0].slice(2);
  }

  function fullYear(y) {
    y = Number(y);
    return y < 100 ? 2000 + y : y;
  }

  function cleanText(text) {
    return String(text || "")
      .replace(/\r/g, "")
      .replace(/[–—]/g, "-")
      .replace(/[ \t ]+/g, " ")
      .replace(/[|¦]/g, " ")
      .split("\n").map(function (l) { return l.trim(); }).filter(Boolean);
  }

  /* ------------------------------------------------------------- units */
  function findUnits(lines) {
    const keyRe = /(?:total\s+)?units?\s*(?:consumed|billed|consumption)|billed\s+units?|total\s+consumption|net\s+consumption|energy\s+consumed|consumption(?:\s*\(?\s*(?:in\s+)?(?:kwh|units?)\s*\)?)?|kwh\s+consumed|total\s+units?|net\s+units?/i;
    const found = [];

    lines.forEach(function (line, i) {
      const m = keyRe.exec(line);
      if (!m) return;
      const rest = line.slice(m.index + m[0].length);
      let val = null;
      const same = new RegExp(NUM).exec(rest);
      if (same) {
        val = toNum(same[1]);
      } else if (lines[i + 1]) {
        // table layout: the labels are on one line and the numbers on the line below
        const nums = numbersIn(lines[i + 1]);
        if (nums.length === 1) val = nums[0];
        else if (nums.length > 1) {
          val = readingMatch(nums);
          if (val === null && rest.trim() === "") val = nums[nums.length - 1];
          else if (val === null && m.index === 0) val = nums[0];
        }
      }
      if (val !== null && val >= 1 && val <= 100000) found.push(val);
    });
    if (found.length) return { value: found[0], confidence: "high", source: "label" };

    // a meter row like "10234 10564 330" even when the labels were not read
    for (let i = 0; i < lines.length; i++) {
      if (/@|\bper\s+unit/i.test(lines[i])) continue;
      const v = readingMatch(numbersIn(lines[i]));
      if (v !== null && v >= 1) return { value: v, confidence: "medium", source: "meter row" };
    }

    // "330 kWh" / "330 units"
    const suffix = [];
    const sRe = new RegExp(NUM + "\\s*(?:kwh|units?)\\b", "ig");
    lines.forEach(function (line) {
      if (/@|per\s+unit|rate|\/\s*unit|\/\s*kwh/i.test(line)) return;
      let m;
      sRe.lastIndex = 0;
      while ((m = sRe.exec(line))) {
        const v = toNum(m[1]);
        if (v !== null && v >= 1 && v <= 100000) suffix.push(v);
      }
    });
    if (suffix.length) return { value: Math.max.apply(null, suffix), confidence: "medium", source: "unit suffix" };

    // meter readings written as "Previous Reading 10234 ... Current Reading 10564"
    const prev = firstMatch(lines, new RegExp("(?:previous|prev\\.?|opening|old|last)\\s*(?:meter\\s*)?reading[^0-9]{0,25}" + NUM, "i"));
    const curr = firstMatch(lines, new RegExp("(?:current|present|closing|new)\\s*(?:meter\\s*)?reading[^0-9]{0,25}" + NUM, "i"));
    if (prev !== null && curr !== null && curr > prev) {
      const mf = firstMatch(lines, new RegExp("(?:multiplying\\s*factor|multiplier|\\bm\\.?f\\.?\\b)[^0-9]{0,15}" + NUM, "i"));
      const factor = mf && mf > 0 && mf <= 1000 ? mf : 1;
      return { value: Math.round((curr - prev) * factor * 100) / 100, confidence: "medium", source: "meter readings" };
    }
    return { value: null, confidence: "none", source: "" };
  }

  function firstMatch(lines, re) {
    for (let i = 0; i < lines.length; i++) {
      const m = re.exec(lines[i]);
      if (m) return toNum(m[1]);
    }
    return null;
  }

  /* ------------------------------------------------------------ amount */
  function findAmount(lines) {
    const groups = [
      /(?:net\s+)?(?:amount|bill)\s+payable|payable\s+amount|net\s+payable|total\s+payable|amount\s+due|net\s+bill\s+amount|net\s+amount|bill\s+amount\s+payable/i,
      /total\s+bill\s+amount|bill\s+amount|current\s+bill|total\s+amount|total\s+bill|current\s+charges|total\s+charges/i,
    ];
    const results = [];
    for (let g = 0; g < groups.length; g++) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const m = groups[g].exec(line);
        if (!m) continue;
        if (/after\s+(?:the\s+)?due|late|delayed|surcharge|arrear|previous/i.test(line)) continue;
        let rest = line.slice(m.index + m[0].length);
        // ignore a due date written after the label
        rest = rest.replace(/\(?\s*due\s*(?:date)?\s*[:\-]?\s*[0-9]{1,2}[\/.\- ][0-9a-z]{1,9}[\/.\- ][0-9]{2,4}\s*\)?/ig, " ");
        let num = new RegExp(MONEY).exec(rest);
        if (!num && lines[i + 1] && !/after\s+due/i.test(lines[i + 1])) {
          num = new RegExp("^[^0-9]{0,12}" + MONEY).exec(lines[i + 1]);
        }
        if (num) {
          const v = fixMoney(num[1]);
          if (v !== null && v >= 1 && v <= 10000000) {
            results.push({ value: v, confidence: g === 0 ? "high" : "medium", source: "label" });
            break;
          }
        }
      }
    }
    if (results.length) {
      // two labels that agree make the answer certain; if they disagree trust the "payable" one but ask to check
      if (results.length === 2 && Math.abs(results[0].value - results[1].value) < 0.5) {
        return { value: results[0].value, confidence: "high", source: "label" };
      }
      if (results.length === 2) return { value: results[0].value, confidence: "medium", source: "label" };
      return results[0];
    }
    // last resort: the biggest number written with a rupee sign
    const money = [];
    const re = new RegExp("(?:\u20b9|rs\\.?|inr)\\s*" + MONEY, "ig");
    lines.forEach(function (line) {
      if (/after\s+due|late|surcharge/i.test(line)) return;
      let m;
      re.lastIndex = 0;
      while ((m = re.exec(line))) {
        const v = fixMoney(m[1]);
        if (v !== null && v >= 1 && v <= 10000000) money.push(v);
      }
    });
    if (money.length) return { value: Math.max.apply(null, money), confidence: "low", source: "largest amount" };
    return { value: null, confidence: "none", source: "" };
  }

  /* ------------------------------------------------------------ period */
  const DATE_RE = "(\\d{1,2})\\s*[\\/.\\-\\s]\\s*(\\d{1,2}|" + MONTH_RE + ")\\s*[\\/.\\-,\\s]\\s*(\\d{4}|\\d{2})";

  function parseDate(d, mo, y) {
    let month = /^\d+$/.test(mo) ? Number(mo) - 1 : monthIndex(mo);
    const day = Number(d);
    const year = fullYear(y);
    if (month < 0 || month > 11 || day < 1 || day > 31 || year < 2000 || year > 2100) return null;
    return new Date(Date.UTC(year, month, day));
  }

  function iso(dt) { return dt.getUTCFullYear() + "-" + pad(dt.getUTCMonth() + 1) + "-" + pad(dt.getUTCDate()); }
  function show(dt) { return pad(dt.getUTCDate()) + " " + MON_SHORT[dt.getUTCMonth()] + " " + dt.getUTCFullYear(); }

  function findPeriod(lines) {
    // 1) a date range:  01-09-2026 to 30-09-2026
    const rangeRe = new RegExp(DATE_RE + "(?:\\s*(?:to|till|upto|up\\s*to|and|-)\\s*|\\s+)" + DATE_RE, "i");
    let best = null;
    for (let i = 0; i < lines.length; i++) {
      let line = lines[i];
      let m = rangeRe.exec(line);
      if (!m && lines[i + 1] && /period|from|billing/i.test(line)) m = rangeRe.exec(line + " " + lines[i + 1]);
      if (!m) continue;
      const a = parseDate(m[1], m[2], m[4]);
      // groups: 1 d,2 mo,3 monthname,4 y, 5 d,6 mo,7 monthname,8 y
      const b = parseDate(m[5], m[6], m[8]);
      if (!a || !b || b < a) continue;
      const days = (b - a) / 86400000;
      if (days < 10 || days > 100) continue;
      const hasLabel = /period|billing|from|consumption|reading/i.test(line);
      if (!best || (hasLabel && !best.hasLabel)) best = { a: a, b: b, hasLabel: hasLabel };
      if (hasLabel) break;
    }
    if (best) {
      const mid = new Date((best.a.getTime() + best.b.getTime()) / 2);
      const key = keyOf(mid.getUTCFullYear(), mid.getUTCMonth());
      return {
        text: show(best.a) + " to " + show(best.b),
        from: iso(best.a), to: iso(best.b),
        monthKey: key, label: labelOf(key),
        confidence: best.hasLabel ? "high" : "medium", source: "period dates",
      };
    }

    // 2) "Bill month: SEP-2026" / "September 2026"
    const mRe = new RegExp("(?:bill(?:ing)?\\s*(?:month|for)|month\\s*of|for\\s+the\\s+month(?:\\s+of)?|consumption\\s+month|bill\\s*period)\\s*[:\\-]?\\s*" + MONTH_RE + "[a-z]*[\\s,.\\-'/]*(\\d{4}|\\d{2})\\b", "i");
    const mnRe = new RegExp("(?:bill(?:ing)?\\s*(?:month|for)|month\\s*of|for\\s+the\\s+month(?:\\s+of)?|consumption\\s+month|bill\\s*period)\\s*[:\\-]?\\s*(\\d{1,2})\\s*[\\/\\-]\\s*(\\d{4})", "i");
    for (let i = 0; i < lines.length; i++) {
      let m = mRe.exec(lines[i]);
      if (m) {
        const mi = monthIndex(m[1]);
        const key = keyOf(fullYear(m[2]), mi);
        return { text: MON_SHORT[mi] + " " + fullYear(m[2]), from: "", to: "", monthKey: key, label: labelOf(key), confidence: "high", source: "bill month" };
      }
      m = mnRe.exec(lines[i]);
      if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) {
        const key = keyOf(Number(m[2]), Number(m[1]) - 1);
        return { text: pad(Number(m[1])) + "/" + m[2], from: "", to: "", monthKey: key, label: labelOf(key), confidence: "high", source: "bill month" };
      }
    }

    // 3) only a bill date: consumption is normally the month before
    const dRe = new RegExp("(?:bill|invoice|issue|reading)\\s*date\\s*[:\\-]?\\s*" + DATE_RE, "i");
    for (let i = 0; i < lines.length; i++) {
      const m = dRe.exec(lines[i]);
      if (m) {
        const d = parseDate(m[1], m[2], m[4]);
        if (!d) continue;
        const prev = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1));
        const key = keyOf(prev.getUTCFullYear(), prev.getUTCMonth());
        return { text: "Bill date " + show(d), from: "", to: "", monthKey: key, label: labelOf(key), confidence: "low", source: "bill date" };
      }
    }
    return { text: "", from: "", to: "", monthKey: "", label: "", confidence: "none", source: "" };
  }

  /* -------------------------------------------------------------- main */
  function parse(text) {
    const lines = cleanText(text);
    return {
      units: findUnits(lines),
      amount: findAmount(lines),
      period: findPeriod(lines),
      lineCount: lines.length,
    };
  }

  // Several readings of the same bill (different OCR modes). Keep the most trusted answer per field,
  // and use the fact that a bill is roughly Rs 1.5 to 30 per unit to throw out numbers that cannot be units.
  const RANK = { high: 3, medium: 2, low: 1, none: 0 };
  function plausible(units, amount) {
    if (!amount) return true;
    const rate = amount / units;
    return rate >= 1 && rate <= 30;
  }
  function parseMany(texts) {
    const rs = texts.map(parse);
    function best(field) {
      let b = null;
      rs.forEach(function (r) { if (!b || RANK[r[field].confidence] > RANK[b.confidence]) b = r[field]; });
      return b || { value: null, confidence: "none", source: "" };
    }
    const amount = best("amount");
    const period = best("period");

    let units = null;
    rs.forEach(function (r) {
      const u = r.units;
      if (u.value === null) return;
      const ok = plausible(u.value, amount.value);
      const score = RANK[u.confidence] + (ok ? 10 : 0);
      if (!units || score > units.score) units = { value: u.value, confidence: u.confidence, source: u.source, score: score, ok: ok };
    });
    if (!units) units = { value: null, confidence: "none", source: "" };
    else if (!units.ok) units = { value: units.value, confidence: "low", source: units.source };
    else units = { value: units.value, confidence: units.confidence, source: units.source };

    return { units: units, amount: amount, period: period, lineCount: rs[0] ? rs[0].lineCount : 0 };
  }

  return { parse: parse, parseMany: parseMany, labelOf: labelOf, cleanText: cleanText, fixMoney: fixMoney };
});
