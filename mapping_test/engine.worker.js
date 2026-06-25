// engine.worker.js — runs the .NET WASM engine + simulation clock off the main
// thread. Posts lightweight per-tick state (~60 Hz) and a heavier graph/series
// payload only on a day change (~3 Hz). Touches no DOM and no FMOD.

// .NET runtime is imported at top level (module worker) so the import fully settles
// before any `init` message is handled. A lazy import triggered from inside the message
// handler leaves dotnet.create() hanging on some static hosts (e.g. GitHub Pages); a
// failed top-level import rejects worker module load -> surfaces via app.js worker.onerror.
const { dotnet } = await import(new URL("./_framework/dotnet.js", import.meta.url).href);

let Engine = null;
let last = 0;
let timer = null;
let cfg = { bay: "alfacs", seed: 0, yearTime: 120, finite: false, endDate: "" };
let lastDay = -1;
let paused = false, ended = false, endIso = null;

const TICK_MS = 16;

// "DD-MM-YYYY" -> "YYYY-MM-DD" so it compares directly with Engine.GetCurrentDate().
function endToIso(s) {
  const m = /^\s*(\d{1,2})-(\d{1,2})-(\d{4})\s*$/.exec(s || "");
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
}

const GRAPH_VARS = [
  "temp_mitjana", "temp_max", "temp_min", "precipitacio", "pressio",
  "thetao_0.5m", "so_0.5m", "caudal_flow (m3/s)", "emb_volume (hm3)", "vent_velocitat",
  "no3_0.5m", "po4_0.5m", "si_0.5m", "o2_0.5m", "ph_0.5m",
];
const READOUT_VARS = [
  "temp_max", "temp_min", "thetao_0.5m", "vent_velocitat", "precipitacio",
  "caudal_flow (m3/s)", "so_0.5m", "no3_0.5m", "si_0.5m", "po4_0.5m",
];

let keys = [];
let runtimeReady = false;
let _wasmBytes = null; // getter -> total WASM linear-memory bytes, or null if unreachable

// performance.memory does not exist in Web Workers, so the engine metric instead reports
// the .NET runtime's WASM linear memory. Probe the Emscripten module across dotnet.js layouts.
function resolveWasmBytes(runtime) {
  const cands = [];
  try { if (runtime && runtime.Module) cands.push(runtime.Module); } catch {}
  try { if (typeof dotnet !== "undefined" && dotnet.instance && dotnet.instance.Module) cands.push(dotnet.instance.Module); } catch {}
  try { if (typeof Module !== "undefined") cands.push(Module); } catch {}
  try { if (globalThis.Module) cands.push(globalThis.Module); } catch {}
  for (const M of cands) {
    try { if (M && M.HEAP8 && M.HEAP8.buffer) return () => M.HEAP8.buffer.byteLength; } catch {}
    try { if (M && M.wasmMemory && M.wasmMemory.buffer) return () => M.wasmMemory.buffer.byteLength; } catch {}
  }
  return null;
}

async function ensureRuntime() {
  if (runtimeReady) return;
  const runtime = await dotnet.create();
  const { getAssemblyExports, getConfig } = runtime;
  const config = getConfig();
  const exports = await getAssemblyExports(config.mainAssemblyName);
  Engine = exports.DiatomBloom.Engine;
  _wasmBytes = resolveWasmBytes(runtime);
  runtimeReady = true;
}

async function boot() {
  await ensureRuntime();
  start();
}

function start() {
  Engine.Init(cfg.bay, cfg.seed, cfg.yearTime);
  keys = Engine.GetSpeciesKeys().split("|").filter(Boolean);
  lastDay = -1;
  paused = false; ended = false;
  endIso = cfg.finite ? endToIso(cfg.endDate) : null;
  postMessage({
    type: "ready",
    keys, graphVars: GRAPH_VARS, readoutVars: READOUT_VARS,
    bay: cfg.bay, secondsPerDayMs: (cfg.yearTime / 365) * 1000,
  });
  postSeries();
  last = performance.now();
  if (!timer) timer = setInterval(tick, TICK_MS);
}

function tick() {
  const now = performance.now();
  if (paused || ended) { last = now; postMessage({ type: "pump" }); return; } // frozen: don't advance, but keep FMOD's mixer pumping (worker clock survives backgrounding)
  const dt = (now - last) / 1000;
  last = now;

  const t0 = performance.now();
  Engine.Update(dt);
  const updateMs = performance.now() - t0;

  postMessage({
    type: "state",
    props: Engine.GetProportions(),
    pans: Engine.GetPans(),
    pops: Engine.GetPopulations(),
    globals: Engine.GetGlobals(),
    meters: Engine.GetMeters(), // [totalPop, windSpeed, windFactor]
    updateMs,
    mem: _wasmBytes ? _wasmBytes() : 0,
  });

  const day = Engine.GetDayIndex();
  if (day !== lastDay) { lastDay = day; postSeries(); }

  if (endIso && Engine.GetCurrentDate() >= endIso) {
    ended = true; // freeze; resume is only via reset/setBay (which call start())
    postMessage({ type: "ended", date: Engine.GetCurrentDate() });
  }
}

function postSeries() {
  const env = {};
  for (const v of GRAPH_VARS) env[v] = Engine.GetEnvWindow(v);
  const pop = {};
  for (const k of keys) pop[k] = Engine.GetPopWindow(k);
  const readouts = {};
  for (const v of READOUT_VARS) readouts[v] = Engine.GetEnvValue(v);
  postMessage({ type: "series", date: Engine.GetCurrentDate(), env, pop, readouts });
}

self.addEventListener("message", (e) => {
  const m = e.data;
  if (m.type === "init") {
    cfg = { ...cfg, ...(m.cfg || {}) };
    boot().catch((err) => postMessage({ type: "error", error: String(err) }));
  } else if (m.type === "reset") {
    // Match Unity ResetSimulation: new random seed AND random bay (temp 0, year start
    // are handled by Engine.Init re-creating the generator at REFERENCE_YEAR).
    cfg.bay = Math.random() < 0.5 ? "alfacs" : "fangar";
    cfg.seed = 0; // 0 -> Engine.Init picks a fresh random seed
    start();
  } else if (m.type === "setBay") {
    cfg.bay = m.bay;
    cfg.seed = 0;
    start();
  } else if (m.type === "tempOffset" && Engine) {
    Engine.SetTemperatureOffset(m.value); // absolute offset
  } else if (m.type === "setPaused") {
    paused = !!m.value;
    if (!paused) last = performance.now(); // avoid a dt spike on resume
  }
});
