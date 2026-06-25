// ui.js — browser dashboard mirroring SimulationUI.cs.

const SPECIES_COLORS = [
  "rgb(102,194,255)", "rgb(255,153,51)", "rgb(153,255,102)", "rgb(255,102,153)",
  "rgb(204,153,255)", "rgb(255,230,77)", "rgb(77,255,204)", "rgb(255,128,128)",
];
// Single source of truth for variable display: [tag, unit, decimals].
// Tags reuse the Unity bottom-bar names (T+, T-, WT, Wind, Rain, Ebre, Sal, NO3, Si, PO4).
const VAR_META = {
  "temp_mitjana": ["Tavg", "\u00b0C", 1],
  "temp_max": ["T+", "\u00b0C", 1],
  "temp_min": ["T-", "\u00b0C", 1],
  "precipitacio": ["Rain", "mm", 1],
  "pressio": ["Pres", "hPa", 0],
  "thetao_0.5m": ["WT", "\u00b0C", 1],
  "so_0.5m": ["Sal", "", 1],
  "caudal_flow (m3/s)": ["Ebre", "m\u00b3/s", 1],
  "emb_volume (hm3)": ["Vol", "hm\u00b3", 1],
  "vent_velocitat": ["Wind", "km/h", 1],
  "no3_0.5m": ["NO\u2083", "", 2],
  "po4_0.5m": ["PO\u2084", "", 2],
  "si_0.5m": ["Si", "", 2],
  "o2_0.5m": ["O\u2082", "", 1],
  "ph_0.5m": ["pH", "", 2],
};
function tagOf(v) { return (VAR_META[v] || [v])[0]; }
function unitOf(v) { return (VAR_META[v] || [v, ""])[1]; }
function fmtMeta(v, val) { const m = VAR_META[v] || [v, "", 1]; return Number.isFinite(val) ? val.toFixed(m[2]) + m[1] : "\u2014"; }

// Variables that share one vertical scale within a panel (so they read as comparable).
// The three air temperatures share a range; everything else autoscales on its own.
const SCALE_GROUPS = { "temp_mitjana": "airtemp", "temp_max": "airtemp", "temp_min": "airtemp" };
function groupOf(v) { return SCALE_GROUPS[v] || null; }

const PANELS = {
  Weather: { title: "Weather", vars: ["temp_mitjana", "temp_max", "temp_min", "precipitacio", "pressio"],
    colors: ["rgb(255,140,51)", "rgb(255,77,77)", "rgb(102,179,255)", "rgb(77,230,128)", "rgb(179,153,230)"] },
  Ocean: { title: "Ocean / River", vars: ["thetao_0.5m", "so_0.5m", "caudal_flow (m3/s)", "emb_volume (hm3)", "vent_velocitat"],
    colors: ["rgb(255,77,102)", "rgb(102,204,255)", "rgb(77,179,128)", "rgb(153,128,77)", "rgb(179,128,230)"] },
  Chem: { title: "Chemistry", vars: ["no3_0.5m", "po4_0.5m", "si_0.5m", "o2_0.5m", "ph_0.5m"],
    colors: ["rgb(102,194,255)", "rgb(255,153,51)", "rgb(153,255,102)", "rgb(255,102,153)", "rgb(204,204,128)"] },
};
const ABBREV = {
  "Cerataulina pelagica": "CtP", "Chaetoceros": "Ch", "Cylindrotheca closterium": "CyC",
  "Leptocylindrus danicus": "LpD", "Leptocylindrus minimus": "LpM", "Pleurosigma": "Ps",
  "Pseudo-nitzschia": "PN", "Thalassionema": "Th",
};
const EXT_DAYS = 76, VISIBLE = 75, NOW_OFFSET = 60;

let _keys = [], _bay = "alfacs", _secPerDayMs = 328.8;
let _panels = {}, _popPanel = null, _lastEnv = null, _lastPop = null;
let _rows = [], _bottomVals = {}, _diatomCells = [];
let _voices, _dateLabel, _metrics, _header, _tempLabel, _bayLabel, _pageLabel, _pauseBtn, _diatomsTotal;
let _tempOffset = 0, _lastSeriesTime = 0, _curPage = 0;
let _page0, _page1, _pages, _nav, _dataBtn;
let _dataOn = false; // graphics block hidden by default; choice persists across rebuilds
let _lastMs = 0, _peakMs = 0, _dayStamps = [];

function el(tag, cls, parent, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  if (parent) parent.appendChild(n);
  return n;
}
function bayName(b) { return (b || "").toLowerCase().startsWith("f") ? "Fangar" : "Alfacs"; }

// A legend item: colored dot + dim tag + bold value. Reused for env panels AND diatoms.
function legendItem(parent, color, tag) {
  const lg = el("span", "legend", parent);
  el("span", "dot", lg).style.background = color;
  el("span", "lt", lg, tag);
  return { item: lg, val: el("span", "lv", lg, "\u2014") };
}

export function initUI(keys, graphVars, readoutVars, bay, secondsPerDayMs) {
  _keys = keys; _bay = bay || "alfacs"; _secPerDayMs = secondsPerDayMs || 328.8;
  _curPage = 0;
  const dash = document.getElementById("dash");
  dash.innerHTML = "";
  dash.classList.add("live");

  _pages = el("div", "pages", dash);
  _page0 = el("div", "page page0 active", _pages);
  for (const name of ["Weather", "Ocean", "Chem"]) buildGraphPanel(_page0, name);
  buildPopPanel(_page0);

  _page1 = el("div", "page page1", _pages);
  _header = el("div", "prop-header", _page1, "Diatom Mix");
  const table = el("div", "prop-table", _page1);
  const head = el("div", "prop-row head", table);
  el("span", "c-name", head, "Species"); el("span", "c-pop", head, "Pop");
  el("span", "c-prop", head, "Prop"); el("span", "c-bar", head, ""); el("span", "c-pan", head, "Pan");
  el("span", "c-panv", head, "");
  _rows = keys.map((k, i) => {
    const row = el("div", "prop-row", table);
    const sw = el("span", "c-name", row);
    el("span", "dot", sw).style.background = SPECIES_COLORS[i % SPECIES_COLORS.length];
    el("span", null, sw, k);
    const pop = el("span", "c-pop", row, "0");
    const prop = el("span", "c-prop", row, "0.000");
    const barWrap = el("span", "c-bar", row);
    const bar = el("div", "bar", barWrap);
    bar.style.background = SPECIES_COLORS[i % SPECIES_COLORS.length];
    const panWrap = el("span", "c-pan", row);
    el("div", "pan-center", panWrap);
    const marker = el("div", "pan-marker", panWrap);
    marker.style.background = SPECIES_COLORS[i % SPECIES_COLORS.length];
    const panv = el("span", "c-panv", row, " 0.00");
    return { pop, prop, bar, marker, panv };
  });

  const info = el("div", "infobar", dash);
  el("span", "ib-title", info, "Mapping The Invisible");
  const ibCenter = el("span", "ib-center", info);
  _bayLabel = el("span", "ib-bay", ibCenter, bayName(_bay)); // static label (no longer switches/restarts)
  el("span", "ib-sep", ibCenter, "|");
  _dateLabel = el("span", "ib-date", ibCenter, "\u2014");
  const ir = el("span", "ib-right", info);
  _voices = el("span", "voices", ir, "0v");
  _pauseBtn = el("button", "ctrl", ir, "Pause");
  _pauseBtn.dataset.short = "P";
  let paused = false;
  _pauseBtn.onclick = () => {
    if (_pauseBtn.disabled) return;
    paused = !paused;
    _pauseBtn.textContent = paused ? "Resume" : "Pause";
    _pauseBtn.classList.toggle("paused", paused);
    window.SonicSilica?.setPaused?.(paused);
  };
  const resetBtn = el("button", "ctrl", ir, "Reset");
  resetBtn.dataset.short = "R";
  resetBtn.onclick = () => { window.SonicSilica?.reset?.(); _tempOffset = 0; updateTempLabel(); };
  const muteBtn = el("button", "ctrl", ir, "Mute");
  muteBtn.dataset.short = "M";
  let muted = false;
  muteBtn.onclick = () => { muted = !muted; muteBtn.textContent = muted ? "Unmute" : "Mute"; muteBtn.classList.toggle("muted", muted); window.SonicSilica?.[muted ? "mute" : "unmute"]?.(); };
  const tg = el("span", "tempgrp", ir);
  el("button", "ctrl tiny", tg, "\u2212").onclick = () => adjustTemp(-0.5);
  _tempLabel = el("span", "temp", tg, "");
  el("button", "ctrl tiny", tg, "+").onclick = () => adjustTemp(0.5);
  updateTempLabel();

  const bottom = el("div", "bottombar", dash);
  const envBox = el("span", "env", bottom);
  const diaItem = el("span", "env-item", envBox); // leftmost: live total-N diatoms (M/K shortened)
  el("span", "env-lbl", diaItem, "Diatoms");
  _diatomsTotal = el("span", "env-val", diaItem, "\u2014");
  for (const v of readoutVars) {
    const item = el("span", "env-item", envBox);
    el("span", "env-lbl", item, tagOf(v));
    _bottomVals[v] = el("span", "env-val", item, "\u2014");
  }

  // Metrics live at the bottom-right (the space the diatom block vacated).
  const m = el("span", "metrics", bottom);
  _metrics = {
    fps: mkMetric(m, "FPS"), rate: mkMetric(m, "d/s"),
    ms: mkMetric(m, "ms"), peak: mkMetric(m, "pk"),
    uiHeap: mkMetric(m, "UI"), engHeap: mkMetric(m, "eng"),
  };
  _dataBtn = el("button", "ctrl databtn", m, "Data"); // shows/hides the whole graphics block
  _dataBtn.onclick = () => applyData(!_dataOn);
  const hideBtn = el("button", "ctrl", m, "Hide"); // folds both bars into the single foldbar
  hideBtn.onclick = () => setFolded(true);

  _nav = el("div", "pagenav", dash);
  el("button", "nav-btn", _nav, "\u25c0").onclick = () => setPage((_curPage + 1) % 2);
  _pageLabel = el("span", "page-lbl", _nav, "1/2");
  el("button", "nav-btn", _nav, "\u25b6").onclick = () => setPage((_curPage + 1) % 2);

  applyData(_dataOn); // apply persisted (default: hidden) state to the fresh DOM

  const foldShow = document.getElementById("fold-show");
  if (foldShow) foldShow.onclick = () => setFolded(false);
  setFolded(false); // each (re)build starts unfolded
}

// Fold both dashboard bars into the single foldbar (Sonic Silica + Show) and back.
// Audio/sim keep running while folded; it's purely a visual collapse.
function setFolded(on) {
  const dash = document.getElementById("dash");
  const fold = document.getElementById("foldbar");
  if (dash) dash.style.display = on ? "none" : ""; // "" -> falls back to #dash.live grid
  if (fold) fold.classList.toggle("show", on);
}

function applyData(on) {
  _dataOn = on;
  if (_pages) _pages.style.display = on ? "" : "none"; // none -> empty transparent row, canvases skip drawing
  if (_nav) _nav.style.display = on ? "" : "none";
  if (_dataBtn) _dataBtn.classList.toggle("active", on);
}

function setPage(n) {
  _curPage = n;
  _page0.classList.toggle("active", n === 0);
  _page1.classList.toggle("active", n === 1);
  if (_pageLabel) _pageLabel.textContent = (n + 1) + "/2";
}
function mkMetric(parent, label) {
  const box = el("span", "metric", parent);
  el("span", "m-lbl", box, label);
  return el("span", "m-val", box, "\u2014");
}
function adjustTemp(d) {
  _tempOffset = Math.max(-5, Math.min(5, Math.round((_tempOffset + d) * 2) / 2));
  updateTempLabel();
  window.SonicSilica?.setTempOffset?.(_tempOffset);
}
function updateTempLabel() {
  if (_tempLabel) _tempLabel.textContent = (_tempOffset >= 0 ? "+" : "") + _tempOffset.toFixed(1) + "\u00b0";
}

function buildGraphPanel(parent, name) {
  const def = PANELS[name];
  const wrap = el("div", "panel", parent);
  const hd = el("div", "panel-hd", wrap);
  el("span", "panel-title", hd, def.title);
  const legendVals = def.vars.map((v, i) => legendItem(hd, def.colors[i], tagOf(v)).val);
  _panels[name] = { canvas: el("canvas", "graph", wrap), vars: def.vars, colors: def.colors, legendVals };
}
function buildPopPanel(parent) {
  const wrap = el("div", "panel", parent);
  const hd = el("div", "panel-hd", wrap);
  el("span", "panel-title", hd, "Diatom Population (N)");
  // Diatom counts, in the panel header, styled exactly like the env legends.
  _diatomCells = _keys.map((k, i) => {
    const li = legendItem(hd, SPECIES_COLORS[i % SPECIES_COLORS.length], ABBREV[k] || k);
    return { item: li.item, val: li.val };
  });
  _popPanel = { canvas: el("canvas", "graph", wrap) };
}

export function onState(s) {
  for (let i = 0; i < _rows.length; i++) {
    const r = _rows[i];
    r.bar.style.width = (Math.max(0, Math.min(1, s.props[i])) * 100).toFixed(1) + "%";
    r.marker.style.left = ((s.pans[i] + 1) * 0.5 * 100).toFixed(1) + "%";
    r.pop.textContent = fmtPop(s.pops[i]);
    r.prop.textContent = s.props[i].toFixed(3);
    r.panv.textContent = (s.pans[i] >= 0 ? "+" : "") + s.pans[i].toFixed(2);
  }
  for (let i = 0; i < _diatomCells.length; i++) {
    const pop = s.pops[i];
    _diatomCells[i].item.style.opacity = pop > 0 ? (0.15 + 0.85 * Math.min(1, Math.pow(pop / 5e5, 0.3))).toFixed(2) : "0.15";
    _diatomCells[i].val.textContent = fmtPop(pop);
  }
  if (s.meters && _header) {
    if (_diatomsTotal) _diatomsTotal.textContent = fmtPop(s.meters[0]);
    _header.textContent = "Diatom Mix    Total N: " + s.meters[0].toFixed(0) +
      "    Wind: " + s.meters[1].toFixed(1) + " km/h (" + s.meters[2].toFixed(2) + ")";
  }
  if (_metrics) {
    _lastMs = _lastMs * 0.9 + s.updateMs * 0.1;
    _peakMs = Math.max(_peakMs * 0.99, s.updateMs);
    _metrics.ms.textContent = _lastMs.toFixed(2);
    _metrics.peak.textContent = _peakMs.toFixed(1);
    if (s.mem) _metrics.engHeap.textContent = (s.mem / 1048576).toFixed(0) + "M";
  }
}

export function onSeries(s) {
  _lastEnv = s.env; _lastPop = s.pop;
  _lastSeriesTime = performance.now();
  if (_dateLabel) _dateLabel.textContent = s.date;
  for (const v in s.readouts) {
    if (_bottomVals[v]) _bottomVals[v].textContent = fmtMeta(v, s.readouts[v]);
  }
  _dayStamps.push(_lastSeriesTime);

  for (const name in _panels) {
    const p = _panels[name];
    p.legendVals.forEach((span, i) => {
      const arr = _lastEnv[p.vars[i]];
      span.textContent = arr && arr.length > NOW_OFFSET ? fmtMeta(p.vars[i], arr[NOW_OFFSET]) : "\u2014";
    });
  }
}

export function renderFrame(now) {
  if (_curPage !== 0 || !_lastEnv) return;
  const t = Math.max(0, Math.min(1, (now - _lastSeriesTime) / _secPerDayMs));
  for (const name in _panels) {
    const p = _panels[name];
    const series = p.vars.map((v) => _lastEnv[v] || []);
    const labels = p.vars.map((v) => ({ tag: tagOf(v), unit: unitOf(v), dec: (VAR_META[v] || [0, 0, 1])[2] }));
    const groups = p.vars.map(groupOf);
    drawLines(p.canvas, series, p.colors, false, t, labels, groups);
  }
  if (_popPanel && _lastPop) {
    const series = _keys.map((k) => _lastPop[k] || []);
    const labels = _keys.map((k) => ({ tag: ABBREV[k] || k, pop: true }));
    drawLines(_popPanel.canvas, series, SPECIES_COLORS, true, t, labels);
  }
}

function drawLines(cv, seriesList, colors, sharedScale, t, labels, groups) {
  const dpr = window.devicePixelRatio || 1;
  const w = cv.clientWidth, h = cv.clientHeight;
  if (w === 0 || h === 0) return;
  cv.width = w * dpr; cv.height = h * dpr;
  const ctx = cv.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const xStep = w / (VISIBLE - 1);
  const nowX = NOW_OFFSET * xStep; // fixed playhead
  ctx.fillStyle = "rgba(255,255,255,0.04)";
  ctx.fillRect(nowX, 0, w - nowX, h);
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.beginPath(); ctx.moveTo(nowX, 0); ctx.lineTo(nowX, h); ctx.stroke();

  const pad = 4;
  let gMin = Infinity, gMax = -Infinity;
  if (sharedScale) for (const s of seriesList) for (const v of s) { if (v < gMin) gMin = v; if (v > gMax) gMax = v; }

  // Combined min/max for any series sharing a scale-group id (e.g. the three air temps).
  const grp = {};
  if (!sharedScale && groups) {
    for (let li = 0; li < seriesList.length; li++) {
      const g = groups[li], s = seriesList[li];
      if (!g || !s || !s.length) continue;
      let r = grp[g] || { mn: Infinity, mx: -Infinity };
      for (const v of s) { if (v < r.mn) r.mn = v; if (v > r.mx) r.mx = v; }
      grp[g] = r;
    }
  }

  const scales = [];
  for (let li = 0; li < seriesList.length; li++) {
    const s = seriesList[li];
    if (!s || !s.length) { scales.push(null); continue; }
    let mn = gMin, mx = gMax;
    if (!sharedScale) {
      const g = groups && groups[li];
      if (g && grp[g]) { mn = grp[g].mn; mx = grp[g].mx; }
      else { mn = Infinity; mx = -Infinity; for (const v of s) { if (v < mn) mn = v; if (v > mx) mx = v; } }
    }
    let range = mx - mn; if (!(range > 0)) range = 1;
    scales.push({ mn, range });
    ctx.strokeStyle = colors[li % colors.length];
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const n = Math.min(s.length, EXT_DAYS);
    for (let i = 0; i < n; i++) {
      const x = (i - t) * xStep;
      const y = h - pad - ((s[i] - mn) / range) * (h - 2 * pad);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // In-place labels at the playhead: variable + value, decluttered, drawn just left of the line.
  if (labels) {
    // Read the current-day sample (constant for the day) rather than the continuously
    // interpolated playhead value — so labels update once per day and hold still while
    // the lines scroll underneath.
    const items = [];
    for (let li = 0; li < seriesList.length; li++) {
      const lab = labels[li], s = seriesList[li], sc = scales[li];
      if (!lab || !s || !s.length || !sc) continue;
      const val = s.length > NOW_OFFSET ? s[NOW_OFFSET] : s[s.length - 1];
      if (lab.pop && Math.abs(val) < 1) continue; // don't mark diatoms = 0
      const text = lab.pop ? lab.tag + " " + fmtPop(val) : lab.tag + " " + val.toFixed(lab.dec) + lab.unit;
      const y = h - pad - ((val - sc.mn) / sc.range) * (h - 2 * pad);
      items.push({ y, text, color: colors[li % colors.length] });
    }
    items.sort((a, b) => a.y - b.y);
    const gap = 11; let prev = -Infinity;
    for (const it of items) { if (it.y < prev + gap) it.y = prev + gap; if (it.y < 7) it.y = 7; if (it.y > h - 3) it.y = h - 3; prev = it.y; }
    ctx.font = "9px 'Iosevka', ui-monospace, monospace";
    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    const xR = nowX - 5;
    for (const it of items) {
      const tw = ctx.measureText(it.text).width;
      ctx.fillStyle = "rgba(8,10,14,0.72)";
      ctx.fillRect(xR - tw - 3, it.y - 6, tw + 5, 12);
      ctx.fillStyle = it.color;
      ctx.fillText(it.text, xR, it.y);
    }
    ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
  }
}

export function setVoices(n) { if (_voices) _voices.textContent = n + "v"; }
export function setEnded(date) {
  if (_dateLabel && date) _dateLabel.textContent = date + "  \u00b7  ENDED";
  if (_pauseBtn) {
    _pauseBtn.disabled = true;
    _pauseBtn.textContent = "Ended";
    _pauseBtn.classList.remove("paused");
    _pauseBtn.classList.add("ended");
  }
}
export function setFps(fps) { if (_metrics) _metrics.fps.textContent = fps.toFixed(0); }
export function setUiHeap(bytes) { if (_metrics && bytes) _metrics.uiHeap.textContent = (bytes / 1048576).toFixed(0) + "M"; }
export function tickRate() {
  const now = performance.now();
  while (_dayStamps.length && _dayStamps[0] < now - 1000) _dayStamps.shift();
  if (_metrics) _metrics.rate.textContent = _dayStamps.length.toFixed(0);
}

function fmtPop(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return Math.round(n).toString();
}
