// fmod.js — FMOD HTML5 (WASM) glue.
//
// Drives the SAME contract SoundManager.cs uses:
//   per-species event  : "event:/Diatoms/<key>", params density, volume, pan
//   global (on system)  : wind, temperature, totalN, pitch_ctl
//   silence (pop<=0)    : density=volume=pan=0
//   mute                : setPaused(true)
//
// Requires the FMOD Studio HTML5 SDK files served alongside this app:
//   fmodstudio.js  (+ fmodstudio.wasm)   — the WASM build, NOT the JS-legacy one
// Get them from your FMOD install: api/studio/lib/wasm/  (Studio includes Core).

// ── THINGS YOU MUST SET to match your FMOD Studio project ──
const FMOD_BANK_FILES = ["Master.bank", "Master.strings.bank"];
const EVENT_PREFIX = "event:/Diatoms/"; // matches SoundManager.EventPathPrefix
const BANK_URL_DIR = "banks/";          // where the .bank files are served from

const FMOD = {};
let gSystem = null;     // FMOD.Studio.System
let gCore = null;       // FMOD.System (core)
let _instances = {};    // speciesKey -> EventInstance
let _ready = false;
let _muted = false;

function CHECK(result, where) {
  if (result !== FMOD.OK) {
    console.error(`FMOD error @ ${where}: ${result} — ${FMOD.ErrorString(result)}`);
  }
  return result;
}

// Called by FMODModule before runtime init: stage bank files into the virtual FS.
FMOD.preRun = function () {
  for (const f of FMOD_BANK_FILES) {
    FMOD.FS_createPreloadedFile("/", f, BANK_URL_DIR + f, true, false);
  }
};

FMOD.onRuntimeInitialized = function () {
  const out = {};
  CHECK(FMOD.Studio_System_Create(out), "Studio_System_Create");
  gSystem = out.val;
  CHECK(gSystem.getCoreSystem(out), "getCoreSystem");
  gCore = out.val;

  // Non-pthread build: software mixer needs regular System::update (called in app.js).
  CHECK(gSystem.initialize(256, FMOD.STUDIO_INIT_NORMAL, FMOD.INIT_NORMAL, null), "initialize");

  for (const bank of FMOD_BANK_FILES) {
    CHECK(gSystem.loadBankFile("/" + bank, FMOD.STUDIO_LOAD_BANK_NORMAL, out), "loadBankFile " + bank);
  }
  console.log("[FMOD] banks loaded");
};

// Public: kick off FMOD load. Resolves once banks are in and the system is up.
export function fmodInit() {
  return new Promise((resolve) => {
    FMOD.TOTAL_MEMORY = 64 * 1024 * 1024;
    const orig = FMOD.onRuntimeInitialized;
    FMOD.onRuntimeInitialized = function () {
      orig();
      _ready = true;
      resolve();
    };
    // FMODModule is the global attached by fmodstudio.js
    // eslint-disable-next-line no-undef
    FMODModule(FMOD);
  });
}

// Create + start one instance per species key (call once, after Engine.Init).
export function fmodCreateInstances(speciesKeys) {
  if (!_ready) return;
  const out = {};
  for (const key of speciesKeys) {
    if (key.startsWith("__")) continue;
    if (_instances[key]) continue;
    const path = EVENT_PREFIX + key;
    if (CHECK(gSystem.getEvent(path, out), "getEvent " + path) !== FMOD.OK) continue;
    const desc = out.val;
    if (CHECK(desc.createInstance(out), "createInstance " + key) !== FMOD.OK) continue;
    const inst = out.val;
    inst.setParameterByName("density", 0.0, false);
    inst.setParameterByName("volume", 0.0, false);
    inst.setParameterByName("pan", 0.0, false);
    inst.start();
    _instances[key] = inst;
  }
}

// Per-frame: push the latest engine state into FMOD.
// keys[], props[], pans[], pops[] are aligned (same order as Engine.GetSpeciesKeys()).
// globals = [windNorm, tempNorm, totalNNorm, pitchCtl].
export function fmodUpdate(keys, props, pans, pops, globals) {
  if (!_ready || _muted) return;

  for (let i = 0; i < keys.length; i++) {
    const inst = _instances[keys[i]];
    if (!inst) continue;
    if (pops[i] <= 0) {
      inst.setParameterByName("density", 0.0, false);
      inst.setParameterByName("volume", 0.0, false);
      inst.setParameterByName("pan", 0.0, false);
      continue;
    }
    const d = Math.min(Math.max(props[i], 0), 1); // ScaleDensity == ScaleVolume == clamp01(prop)
    inst.setParameterByName("density", d, false);
    inst.setParameterByName("volume", d, false);
    inst.setParameterByName("pan", Math.max(-1, Math.min(1, pans[i])), false);
  }

  gSystem.setParameterByName("wind", globals[0], false);
  gSystem.setParameterByName("temperature", globals[1], false);
  gSystem.setParameterByName("totalN", globals[2], false);
  gSystem.setParameterByName("pitch_ctl", globals[3], false);
}

// Must run regularly or audio stutters (non-pthread build).
export function fmodTick() {
  if (_ready && gSystem) gSystem.update();
}

export function fmodSetMuted(m) {
  _muted = m;
  for (const k in _instances) _instances[k].setPaused(m);
}

// Pause/resume ALL audio via the master channel group. Independent of fmodSetMuted
// (instance-level), so mute and pause states don't clobber each other.
export function fmodSetPaused(p) {
  if (!_ready || !gCore) return;
  try {
    const out = {};
    if (CHECK(gCore.getMasterChannelGroup(out), "getMasterChannelGroup") !== FMOD.OK) return;
    out.val.setPaused(p);
  } catch (e) {
    console.warn("[FMOD] setPaused failed:", e);
  }
}

// Channels currently playing (the "poly"/voice count shown in the top bar).
export function fmodVoices() {
  if (!_ready || !gCore) return 0;
  const ch = {}, real = {};
  try {
    gCore.getChannelsPlaying(ch, real);
    return ch.val | 0;
  } catch {
    return 0;
  }
}

// Unstick the browser audio context (Chrome/Safari autoplay policy): suspend then
// resume the core mixer. Called right after init while the page still holds the
// Start-click activation, so sound starts on that single click — no extra gesture.
export function fmodResume() {
  if (!_ready || !gCore) return false;
  try {
    gCore.mixerSuspend();
    gCore.mixerResume();
    return true;
  } catch (e) {
    console.warn("[FMOD] mixerResume failed:", e);
    return false;
  }
}
