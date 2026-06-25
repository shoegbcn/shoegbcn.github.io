// app.js — main thread. Owns FMOD + the dashboard UI; the .NET engine runs in
// engine.worker.js. Worker state drives FMOD and the UI; a main-thread rAF loop
// drives display-only metrics and the smooth graph scroll.

import { fmodInit, fmodCreateInstances, fmodUpdate, fmodTick, fmodSetMuted, fmodSetPaused, fmodVoices, fmodResume } from "./fmod.js";
import { initUI, onState, onSeries, renderFrame, setVoices, setFps, setUiHeap, tickRate, setEnded } from "./ui.js";

const BAY = "alfacs";   // "alfacs" | "fangar"
const SEED = 0;         // 0 = random
const YEAR_TIME = 120;  // seconds per simulated year
const FINITE = false;          // true = stop advancing at END_DATE (sim freezes, audio sustains)
const END_DATE = "31-12-2025"; // DD-MM-YYYY, used only when FINITE is true

let worker = null;
let keys = [];
let instancesCreated = false;
let fmodOk = true;

// Kick FMOD init off at page load. This creates the (suspended) audio context up
// front, so by the time the user clicks Start the system already exists and we can
// resume it *synchronously inside the click handler* — which is what the autoplay
// policy actually requires. Resuming after an awaited init misses the gesture and
// is why a second click was needed.
let initPromise = null;
function ensureInit() {
  if (!initPromise) {
    initPromise = fmodInit().catch((e) => {
      fmodOk = false;
      console.error("FMOD init failed — UI will run without audio:", e);
      document.getElementById("status").textContent = "Audio unavailable: " + e;
    });
  }
  return initPromise;
}
ensureInit();

async function boot() {
  await ensureInit();
  fmodResume(); // belt-and-suspenders; the in-gesture call in the click handler is the one that counts

  worker = new Worker(new URL("./engine.worker.js", import.meta.url), { type: "module" });
  worker.onerror = (ev) => {
    console.error("engine worker failed:", ev.message || ev);
    showStartError("Engine failed to start: " + (ev.message || "worker error — see console"));
  };
  worker.onmessage = (e) => {
    const m = e.data;
    if (m.type === "ready") {
      keys = m.keys;
      try {
        if (fmodOk && !instancesCreated) { fmodCreateInstances(keys); instancesCreated = true; }
      } catch (err) {
        fmodOk = false; // audio failure must not block the dashboard
        console.error("FMOD instance creation failed — UI runs without audio:", err);
      }
      initUI(keys, m.graphVars, m.readoutVars, m.bay, m.secondsPerDayMs);
      startLoop();
      const ps = document.getElementById("prestart"); if (ps) ps.remove(); // dashboard is up now
    } else if (m.type === "state") {
      if (fmodOk) { fmodUpdate(keys, m.props, m.pans, m.pops, m.globals); fmodTick(); } // worker clock pumps the mixer (survives backgrounding)
      onState(m);
    } else if (m.type === "pump") {
      if (fmodOk) fmodTick(); // frozen (paused/ended): keep the mixer alive off the worker clock
    } else if (m.type === "series") {
      onSeries(m);
    } else if (m.type === "ended") {
      setEnded(m.date); // sim frozen at the end date; FMOD keeps sustaining the last params
    } else if (m.type === "error") {
      console.error("engine worker:", m.error);
      showStartError("Engine error: " + m.error);
    }
  };
  worker.postMessage({ type: "init", cfg: { bay: BAY, seed: SEED, yearTime: YEAR_TIME, finite: FINITE, endDate: END_DATE } });

  window.SonicSilica = {
    mute: () => fmodSetMuted(true),
    unmute: () => fmodSetMuted(false),
    setTempOffset: (v) => worker.postMessage({ type: "tempOffset", value: v }),
    reset: () => worker.postMessage({ type: "reset" }),
    setBay: (bay) => worker.postMessage({ type: "setBay", bay }),
    setPaused: (p) => { worker.postMessage({ type: "setPaused", value: p }); if (fmodOk) fmodSetPaused(p); },
  };
}

let _loopStarted = false;
function startLoop() {
  if (_loopStarted) return;
  _loopStarted = true;
  let frames = 0, lastSec = performance.now();
  function frame(now) {
    renderFrame(now);          // smooth graph scroll (visual; throttles in background, which is fine)
    frames++;
    if (now - lastSec >= 500) {
      setFps((frames * 1000) / (now - lastSec));
      frames = 0; lastSec = now;
      setVoices(fmodVoices());
      if (performance.memory) setUiHeap(performance.memory.usedJSHeapSize);
      tickRate();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// At load only the 3D model and a bottom bar with the Start button are shown (static HTML).
// Hitting Start performs the audio gesture, removes the pre-start bar, and boots the engine
// + full dashboard — nothing runs until then, and from there it behaves as before.
function showStartError(msg) {
  const btn = document.getElementById("start");
  if (btn) { btn.textContent = msg; btn.disabled = false; }
  const st = document.getElementById("status"); if (st) st.textContent = msg;
}

document.getElementById("start").addEventListener("click", () => {
  fmodResume(); // synchronous, inside the gesture — un-suspends the audio context

  // Keep the pre-start bar visible (showing progress) until the dashboard is actually
  // ready — a slow or failed boot then never leaves a blank screen, and any error
  // shows on the button itself.
  const btn = document.getElementById("start");
  btn.textContent = "Starting…"; btn.disabled = true;

  // Backstop: if FMOD init lost the race, the next interaction resumes.
  const backstop = () => { fmodResume(); window.removeEventListener("pointerdown", backstop); window.removeEventListener("keydown", backstop); };
  window.addEventListener("pointerdown", backstop);
  window.addEventListener("keydown", backstop);

  boot().catch((e) => {
    console.error(e);
    showStartError("Boot failed: " + (e && e.message ? e.message : e));
  });
});
