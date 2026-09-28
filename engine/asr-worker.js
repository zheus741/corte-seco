/* Corte Seco desktop — one native Whisper worker (worker_threads).
   Loads onnxruntime-node and the shared WhisperCore, then transcribes chunks on request. */
'use strict';
const { parentPort, workerData } = require('worker_threads');
const path = require('path');
const fs = require('fs');

let ort, S = null, table = null;

function post(m) { parentPort.postMessage(m); }

async function init() {
  const { coreFile, model, enc, dec, tokens, threads } = workerData;
  ort = require('onnxruntime-node');
  require(coreFile); // defines globalThis.WhisperCore
  const opts = {
    executionProviders: ['cpu'],
    graphOptimizationLevel: 'all',
    intraOpNumThreads: Math.max(1, threads | 0),
    interOpNumThreads: 1,
    enableCpuMemArena: true
  };
  // a model can be one file or a list of chunks (the bundled model ships split in pieces)
  const src = (x) => Array.isArray(x) ? Buffer.concat(x.map((p) => fs.readFileSync(p))) : x;
  S = await globalThis.WhisperCore.createSessions(ort, src(enc), src(dec), model, opts);
  table = globalThis.WhisperCore.parseTokens(fs.readFileSync(tokens, 'utf8'));
}

parentPort.on('message', async (m) => {
  if (m.type !== 'chunk') return;
  try {
    const t0 = Date.now();
    const pcm = m.pcm instanceof Float32Array ? m.pcm : new Float32Array(m.pcm);
    const r = await globalThis.WhisperCore.transcribeChunk(ort, S, table, pcm, m.lang || 'pt');
    post({ type: 'chunk', id: m.id, segments: r.segments, lang: r.lang, ms: Date.now() - t0 });
  } catch (e) {
    post({ type: 'error', id: m.id, message: String(e && e.message || e) });
  }
});

init().then(() => post({ type: 'ready' }), (e) => post({ type: 'error', id: null, message: 'init: ' + String(e && e.message || e) }));
