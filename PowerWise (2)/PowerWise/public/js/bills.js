(async function () {
  "use strict";
  const $ = function (s) { return document.querySelector(s); };
  const el = PW.el;

  const user = await PW.init("bills");
  if (!user) return;

  let profile;
  try { profile = await PW.loadProfile(); } catch (e) { PW.showOffline(); return; }

  let bills = profile.bills.slice();
  const labels = PW.monthLabels();

  /* ------------------------------------------------------ script loading */
  const loaded = {};
  function loadScript(src) {
    if (!loaded[src]) {
      loaded[src] = new Promise(function (resolve, reject) {
        const s = document.createElement("script");
        s.src = src;
        s.onload = resolve;
        s.onerror = function () { reject(new Error("Could not load " + src)); };
        document.head.appendChild(s);
      });
    }
    return loaded[src];
  }

  /* --------------------------------------------------------- progress UI */
  function setProgress(pct, text) {
    $("#progressBox").hidden = false;
    $("#bar").style.width = Math.max(2, Math.min(100, pct)) + "%";
    if (text !== undefined) $("#status").textContent = text;
  }
  function hideProgress() { $("#progressBox").hidden = true; }

  /* ------------------------------------------------------------ OCR engine */
  let worker = null;
  let stage = { base: 0, span: 100 };

  async function getWorker() {
    if (worker) return worker;
    setProgress(4, "Starting the bill reader (first time only)…");
    await loadScript("vendor/tesseract/tesseract.min.js");
    const base = new URL("vendor/tesseract", location.href).href;
    worker = await Tesseract.createWorker("eng", 1, {
      workerPath: base + "/worker.min.js",
      corePath: base,
      langPath: base + "/lang",
      workerBlobURL: false,
      cacheMethod: "none",
      logger: function (m) {
        if (m.status === "recognizing text") {
          setProgress(stage.base + m.progress * stage.span, "Reading the bill… " + Math.round(m.progress * 100) + "%");
        } else if (/load|initializ/i.test(m.status)) {
          setProgress(6 + (m.progress || 0) * 14, "Starting the bill reader…");
        }
      },
    });
    await worker.setParameters({ preserve_interword_spaces: "1" });
    return worker;
  }

  function complete(r) {
    return r.units.confidence !== "none" && r.amount.confidence !== "none" && r.period.monthKey !== "";
  }

  // Bills are full of boxes and tables, and different layouts need different reading modes.
  // The page is read in the normal way first. Only if units, amount or month are still missing,
  // it is read again in two other ways, and the best answer from all readings is used.
  async function ocrPasses(img, base, span) {
    const w = await getWorker();
    const plan = [
      function () { return [img.canvas, "3"]; },
      function () { return [img.canvas, "6"]; },
      function () { return [img.plain(), "4"]; },
    ];
    const texts = [];
    for (let i = 0; i < plan.length; i++) {
      if (i > 0 && complete(BillParse.parseMany(texts))) break;
      stage = { base: base + (i * span) / plan.length, span: span / plan.length };
      const step = plan[i]();
      await w.setParameters({ tessedit_pageseg_mode: step[1], preserve_interword_spaces: "1" });
      const res = await w.recognize(step[0]);
      texts.push(res.data.text || "");
    }
    return texts;
  }

  /* ---------------------------------------------------------- file to text */
  function drawToCanvas(source, sw, sh, grey) {
    // bring the picture to a size that suits OCR, in greyscale with a little extra contrast
    const longest = Math.max(sw, sh);
    let scale = 1;
    if (longest > 3000) scale = 3000 / longest;
    else if (longest < 1800) scale = Math.min(2.5, 1800 / longest);
    const c = document.createElement("canvas");
    c.width = Math.round(sw * scale);
    c.height = Math.round(sh * scale);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    if (grey !== false) { try { ctx.filter = "grayscale(1) contrast(1.2)"; } catch (e) { /* not supported */ } }
    ctx.drawImage(source, 0, 0, c.width, c.height);
    return c;
  }

  async function imageToCanvas(file) {
    let bmp;
    try {
      bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch (e) {
      bmp = await new Promise(function (resolve, reject) {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = function () { resolve(img); };
        img.onerror = function () { reject(new Error("This picture format cannot be opened. Please use a JPG or PNG (on iPhone, share the photo as JPG or take a screenshot).")); };
        img.src = url;
      });
    }
    const w = bmp.width || bmp.naturalWidth, h = bmp.height || bmp.naturalHeight;
    return {
      canvas: drawToCanvas(bmp, w, h, true),               // greyscale, a little more contrast
      plain: function () { return drawToCanvas(bmp, w, h, false); },
    };
  }

  function showPreview(canvas) {
    const p = $("#preview");
    const max = 640;
    const k = Math.min(1, max / canvas.width);
    p.width = Math.round(canvas.width * k);
    p.height = Math.round(canvas.height * k);
    const ctx = p.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, p.width, p.height);
    ctx.drawImage(canvas, 0, 0, p.width, p.height);
    $("#previewBox").hidden = false;
  }

  async function pdfToText(file) {
    setProgress(8, "Opening the PDF…");
    await loadScript("vendor/pdfjs/pdf.min.js");
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("vendor/pdfjs/pdf.worker.min.js", location.href).href;
    let doc;
    try {
      doc = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    } catch (e) {
      if (e && e.name === "PasswordException") throw new Error("This PDF is password protected. Please remove the password and try again.");
      throw new Error("This PDF could not be opened.");
    }
    const pages = Math.min(doc.numPages, 3);

    // 1) most bills downloaded from a website already contain real text
    let text = "";
    for (let n = 1; n <= pages; n++) {
      const page = await doc.getPage(n);
      const tc = await page.getTextContent();
      const rows = {};
      tc.items.forEach(function (it) {
        if (!it.str || !it.str.trim()) return;
        const y = Math.round(it.transform[5] / 4);
        (rows[y] = rows[y] || []).push({ x: it.transform[4], s: it.str });
      });
      Object.keys(rows).map(Number).sort(function (a, b) { return b - a; }).forEach(function (y) {
        text += rows[y].sort(function (a, b) { return a.x - b.x; }).map(function (i) { return i.s; }).join(" ") + "\n";
      });
    }
    if (text.replace(/\s/g, "").length > 80 && /\d/.test(text)) {
      setProgress(60, "Reading the text inside the PDF…");
      const first = await doc.getPage(1);
      const vp = first.getViewport({ scale: 1 });
      const prev = document.createElement("canvas");
      prev.width = Math.round(vp.width * 1.4); prev.height = Math.round(vp.height * 1.4);
      await first.render({ canvasContext: prev.getContext("2d"), viewport: first.getViewport({ scale: 1.4 }) }).promise;
      showPreview(prev);
      return { texts: [text], method: "PDF text" };
    }

    // 2) scanned PDF: draw the first pages and read them like photos
    const all = [];
    const ocrPages = Math.min(doc.numPages, 2);
    for (let n = 1; n <= ocrPages; n++) {
      const page = await doc.getPage(n);
      const vp = page.getViewport({ scale: 2.4 });
      const c = document.createElement("canvas");
      c.width = Math.round(vp.width); c.height = Math.round(vp.height);
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      if (n === 1) showPreview(c);
      const t = await ocrPasses({ canvas: c, plain: function () { return c; } }, 20 + (n - 1) * (80 / ocrPages), 80 / ocrPages);
      all.push.apply(all, t);
    }
    return { texts: all, method: "OCR" };
  }

  /* ---------------------------------------------------------------- queue */
  let queue = [];
  let qIndex = -1;
  let current = null;   // {file name}
  let busy = false;

  function isPdf(f) { return f.type === "application/pdf" || /\.pdf$/i.test(f.name); }

  function startQueue(files) {
    queue = Array.prototype.slice.call(files);
    qIndex = -1;
    next();
  }

  async function next() {
    qIndex++;
    if (qIndex >= queue.length) { finishQueue(); return; }
    await processFile(queue[qIndex]);
  }

  function finishQueue() {
    current = null;
    $("#reviewForm").hidden = true;
    $("#rawBox").hidden = true;
    $("#queueInfo").textContent = "";
    $("#reviewHint").hidden = false;
    $("#reviewHint").textContent = queue.length
      ? "All done. Your saved bills are listed below. Add more months, or go on to the prediction."
      : "Choose a bill on the left. The numbers PowerWise reads will appear here so you can check them before saving.";
    queue = [];
  }

  async function processFile(file) {
    busy = true;
    current = { name: file.name };
    $("#reviewForm").hidden = true;
    $("#rawBox").hidden = true;
    $("#reviewHint").hidden = false;
    $("#reviewHint").textContent = "Reading " + file.name + "…";
    $("#queueInfo").textContent = queue.length > 1 ? "(file " + (qIndex + 1) + " of " + queue.length + ")" : "";
    $("#previewBox").hidden = true;
    setProgress(2, "Preparing…");
    try {
      let texts, method;
      if (isPdf(file)) {
        const r = await pdfToText(file);
        texts = r.texts; method = r.method;
      } else if (/^image\//.test(file.type) || /\.(png|jpe?g|webp|bmp|gif)$/i.test(file.name)) {
        const img = await imageToCanvas(file);
        showPreview(img.canvas);
        texts = await ocrPasses(img, 22, 78);
        method = "OCR";
      } else {
        throw new Error("Please choose a JPG, PNG or PDF file.");
      }
      setProgress(100, "Done. Please check the numbers on the right.");
      setTimeout(hideProgress, 1500);
      showResult(file.name, texts.join("\n----- second reading -----\n"), BillParse.parseMany(texts), method);
    } catch (e) {
      hideProgress();
      PW.toast(e.message || "Could not read this file", true);
      showResult(file.name, "", BillParse.parseMany([""]), "none", e.message);
    } finally {
      busy = false;
    }
  }

  /* ------------------------------------------------------------ review form */
  function hint(id, info, unit) {
    const h = $(id);
    h.className = "hint";
    if (info.value === null || info.value === undefined || info.value === "" || info.confidence === "none") {
      h.textContent = "Not found. Please type it.";
      h.classList.add("none");
    } else if (info.confidence === "high") {
      h.textContent = "Found on the bill";
      h.classList.add("good");
    } else {
      h.textContent = "Please double-check this";
      h.classList.add("warn");
    }
  }

  function showResult(name, text, r, method, errMsg) {
    $("#reviewHint").hidden = true;
    $("#reviewForm").hidden = false;
    $("#formMsg").textContent = errMsg || "";
    $("#f_period").value = r.period.text || "";
    $("#f_month").value = r.period.monthKey || "";
    $("#f_units").value = r.units.value !== null ? r.units.value : "";
    $("#f_amount").value = r.amount.value !== null ? r.amount.value : "";
    hint("#h_units", r.units);
    hint("#h_amount", r.amount);
    const hp = $("#h_period");
    hp.className = "hint";
    if (!r.period.monthKey) { hp.textContent = "Billing period not found. Please pick the month below."; hp.classList.add("none"); }
    else if (r.period.confidence === "high") { hp.textContent = "Found on the bill"; hp.classList.add("good"); }
    else { hp.textContent = "Please double-check the month"; hp.classList.add("warn"); }

    $("#rawText").textContent = text.trim() || "(nothing was read)";
    $("#rawBox").hidden = !text.trim();
    current = { name: name || "" };
    if (!$("#f_units").value) $("#f_units").focus();
  }

  $("#reviewForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    const msg = $("#formMsg");
    msg.textContent = "";
    const monthKey = $("#f_month").value;
    const units = Number($("#f_units").value);
    const amountRaw = $("#f_amount").value;
    const amount = amountRaw === "" ? 0 : Number(amountRaw);
    if (!/^20\d\d-(0[1-9]|1[0-2])$/.test(monthKey)) { msg.textContent = "Please choose the bill month."; return; }
    if (!$("#f_units").value || !(units > 0)) { msg.textContent = "Please enter the units used."; return; }
    if (!(amount >= 0)) { msg.textContent = "The bill amount is not valid."; return; }

    const label = PW.keyLabel(monthKey);
    const bill = {
      id: Math.random().toString(16).slice(2, 14),
      monthKey: monthKey,
      label: label,
      units: units,
      amount: amount,
      period: $("#f_period").value.trim(),
      file: current && current.name ? current.name : "typed by hand",
      ts: Math.floor(Date.now() / 1000),
    };
    const replaced = bills.some(function (b) { return b.monthKey === monthKey; });
    const list = bills.filter(function (b) { return b.monthKey !== monthKey; }).concat([bill]);
    try {
      await PW.api("PUT", "/api/profile", {
        bills: list,
        log: {
          type: "bill",
          summary: "Bill saved for " + label + ": " + units + " kWh" + (amount ? ", " + PW.inr(amount) : ""),
          detail: "File: " + bill.file + (bill.period ? " · Period: " + bill.period : ""),
        },
      });
      bills = list.sort(function (a, b) { return a.monthKey < b.monthKey ? -1 : 1; });
      renderBills();
      PW.toast(replaced ? "Replaced your earlier " + label + " bill" : "Saved to your history");
      if (queue.length) next(); else finishQueue();
    } catch (err) {
      msg.textContent = err.message === "SERVER_OFFLINE" ? "Server is not running." : err.message;
    }
  });

  $("#btnSkip").addEventListener("click", function () {
    if (queue.length) next(); else finishQueue();
  });

  /* ---------------------------------------------------------- saved bills */
  function renderBills() {
    const body = $("#billRows");
    body.textContent = "";
    const rows = bills.slice().sort(function (a, b) { return a.monthKey < b.monthKey ? 1 : -1; });
    if (!rows.length) {
      body.appendChild(el("tr", {}, el("td", { colspan: "7", class: "empty", text: "No bills saved yet. Upload one above." })));
    }
    rows.forEach(function (b) {
      body.appendChild(el("tr", {},
        el("td", {}, el("strong", { text: b.label || PW.keyLabel(b.monthKey) })),
        el("td", { text: b.units + " kWh" }),
        el("td", { text: b.amount ? PW.inr(b.amount) : "–" }),
        el("td", { text: b.period || "–" }),
        el("td", { class: "muted", text: b.file || "–", style: "max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" }),
        el("td", { text: PW.fmtDate(b.ts), style: "white-space:nowrap" }),
        el("td", {}, el("button", {
          class: "btn-del", type: "button", title: "Delete this bill",
          onclick: async function () {
            const list = bills.filter(function (x) { return x.id !== b.id; });
            try { await PW.api("PUT", "/api/profile", { bills: list }); bills = list; renderBills(); PW.toast("Bill removed"); }
            catch (err) { PW.toast(err.message, true); }
          },
        }, "✕"))));
    });

    // which of the last 6 months do we have?
    const chips = $("#chips");
    chips.textContent = "";
    let have = 0;
    labels.pastKeys.forEach(function (key, i) {
      const b = bills.find(function (x) { return x.monthKey === key; });
      if (b) have++;
      chips.appendChild(el("span", { class: "chip " + (b ? "yes" : "no") },
        (b ? "✓ " : "+ ") + labels.past[i], b ? " · " + b.units + " kWh" : ""));
    });
    $("#coverText").textContent = have === 6
      ? "You have all 6 months needed. The prediction page will fill itself."
      : have + " of the last 6 months are covered. The prediction page fills these months for you, and you only type the missing ones.";
    $("#goPredict").style.opacity = have ? "1" : ".6";
  }

  /* ------------------------------------------------------------- controls */
  const fileInput = $("#file");
  fileInput.addEventListener("change", function () {
    if (fileInput.files.length && !busy) startQueue(fileInput.files);
    fileInput.value = "";
  });

  const drop = $("#drop");
  ["dragenter", "dragover"].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("over"); });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("over"); });
  });
  drop.addEventListener("drop", function (e) {
    if (e.dataTransfer && e.dataTransfer.files.length && !busy) startQueue(e.dataTransfer.files);
  });

  async function loadSample(path, name, type) {
    if (busy) return;
    try {
      const res = await fetch(path);
      if (!res.ok) throw new Error("Sample not found");
      const blob = await res.blob();
      startQueue([new File([blob], name, { type: type })]);
    } catch (e) {
      PW.toast("Could not load the sample", true);
    }
  }
  $("#btnSample").addEventListener("click", function () { loadSample("samples/sample-bill.png", "sample-bill.png", "image/png"); });
  $("#btnSamplePdf").addEventListener("click", function () { loadSample("samples/sample-bill.pdf", "sample-bill.pdf", "application/pdf"); });

  $("#btnManual").addEventListener("click", function () {
    if (busy) return;
    queue = []; qIndex = -1;
    $("#previewBox").hidden = true;
    showResult("", "", BillParse.parseMany([""]), "none");
    $("#queueInfo").textContent = "(typed by hand)";
  });

  window.addEventListener("pagehide", function () { if (worker) worker.terminate(); });

  renderBills();
})();
