/* Corte Seco — transcription worker. Runs Whisper on onnxruntime-web (wasm, single thread). */
let S = null, table = null, ready = null;

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      importScripts(m.base + 'ort/ort.wasm.min.js', m.base + 'asr-core.js');
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
      ort.env.wasm.wasmPaths = m.base + 'ort/';
      if (m.wasmBinary) ort.env.wasm.wasmBinary = m.wasmBinary;
      S = await WhisperCore.createSessions(ort, m.enc, m.dec, m.model);
      table = WhisperCore.parseTokens(m.tokens);
      self.postMessage({ type: 'ready' });
    } else if (m.type === 'chunk') {
      const t0 = performance.now();
      const r = await WhisperCore.transcribeChunk(ort, S, table, m.pcm, m.lang);
      self.postMessage({ type: 'chunk', id: m.id, segments: r.segments, lang: r.lang, ms: performance.now() - t0 });
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: m.id, stage: m.type, message: String(err && err.message || err) });
  }
};
