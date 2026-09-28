/* Corte Seco desktop — transcription host.
   Runs as an Electron utility process (or a plain Node child for tests) and keeps a pool of
   native Whisper workers warm. Chunks are dispatched to whichever worker is idle. */
'use strict';
const { Worker } = require('worker_threads');
const path = require('path');

const port = process.parentPort
  ? { on: (fn) => process.parentPort.on('message', (e) => fn(e.data)), send: (m) => process.parentPort.postMessage(m) }
  : { on: (fn) => process.on('message', fn), send: (m) => process.send(m) };

let pool = [];       // [{w, busy, ready}]
let loadedKey = null;
const queue = [];    // pending chunk messages
let loading = null;

function dispatch() {
  while (queue.length) {
    const slot = pool.find((s) => s.ready && s.busy == null);
    if (!slot) return;
    const m = queue.shift();
    slot.busy = m.id;
    slot.w.postMessage(m, m.pcm && m.pcm.buffer ? [m.pcm.buffer] : []);
  }
}

async function killPool() {
  const old = pool; pool = [];
  await Promise.all(old.map((s) => s.w.terminate().catch(() => {})));
}

function spawn(cfg, threads) {
  return new Promise((resolve, reject) => {
    const w = new Worker(path.join(__dirname, 'asr-worker.js'), {
      workerData: { coreFile: cfg.coreFile, model: cfg.model, enc: cfg.enc, dec: cfg.dec, tokens: cfg.tokens, threads }
    });
    const slot = { w, busy: null, ready: false };
    const onFirst = (m) => {
      if (m.type === 'ready') { slot.ready = true; w.off('message', onFirst); w.on('message', (x) => onMsg(slot, x)); resolve(slot); }
      else if (m.type === 'error') { w.off('message', onFirst); w.terminate(); reject(new Error(m.message)); }
    };
    w.on('message', onFirst);
    w.on('error', (e) => { if (!slot.ready) reject(e); else failSlot(slot, e); });
    w.on('exit', (code) => { if (slot.ready && code !== 0) failSlot(slot, new Error('o motor fechou (' + code + ')')); });
  });
}

function failSlot(slot, e) {
  pool = pool.filter((s) => s !== slot);
  if (slot.busy != null) port.send({ type: 'error', id: slot.busy, message: String(e && e.message || e) });
  slot.busy = null;
}

function onMsg(slot, m) {
  if (m.type === 'chunk' || m.type === 'error') {
    slot.busy = null;
    port.send(m);
    dispatch();
  }
}

port.on(async (m) => {
  try {
    if (m.type === 'load') {
      const key = [m.model, m.enc, m.dec, m.workers, m.threads].join('|');
      if (key === loadedKey && pool.length) { port.send({ type: 'loaded', model: m.model, workers: pool.length, ms: 0, warm: true }); return; }
      if (loading) await loading.catch(() => {});
      await killPool();
      const t0 = Date.now();
      const n = Math.max(1, m.workers | 0), th = Math.max(1, m.threads | 0);
      // first worker alone (so an error surfaces fast), the rest in parallel
      loading = (async () => {
        const first = await spawn(m, th);
        pool.push(first); dispatch();
        port.send({ type: 'loaded', model: m.model, workers: 1, ms: Date.now() - t0 });
        const rest = await Promise.allSettled(Array.from({ length: n - 1 }, () => spawn(m, th)));
        for (const r of rest) if (r.status === 'fulfilled') { pool.push(r.value); dispatch(); }
        port.send({ type: 'pool', workers: pool.length });
      })();
      await loading;
      loadedKey = key;
    } else if (m.type === 'chunk') {
      if (m.pcm && !(m.pcm instanceof Float32Array)) m.pcm = new Float32Array(m.pcm.buffer ? m.pcm.buffer : m.pcm);
      queue.push(m); dispatch();
    } else if (m.type === 'cancel') {
      queue.length = 0;
    } else if (m.type === 'unload') {
      queue.length = 0; await killPool(); loadedKey = null;
      port.send({ type: 'unloaded' });
    }
  } catch (e) {
    loadedKey = null;
    port.send({ type: 'error', id: m.id != null ? m.id : null, stage: m.type, message: String(e && e.message || e) });
  }
});
port.send({ type: 'hello', pid: process.pid });
