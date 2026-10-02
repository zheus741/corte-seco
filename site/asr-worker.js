/* Corte Seco — transcription worker. Runs Whisper on onnxruntime-web (wasm; one or more threads). */
let S = null, table = null, ready = null;

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      importScripts(m.base + 'ort/ort.wasm.min.js', m.base + 'asr-core.js');
      // vários núcleos dentro do mesmo motor quando a página permite (cross-origin isolated)
      const threads = m.threads > 1 && self.crossOriginIsolated ? m.threads : 1;
      ort.env.wasm.numThreads = threads;
      ort.env.wasm.proxy = false;
      ort.env.wasm.wasmPaths = m.base + 'ort/';
      if (m.wasmBinary) ort.env.wasm.wasmBinary = m.wasmBinary;
      try { S = await WhisperCore.createSessions(ort, m.enc, m.dec, m.model); }
      catch (err) { if (threads === 1) throw err; ort.env.wasm.numThreads = 1; S = await WhisperCore.createSessions(ort, m.enc, m.dec, m.model); }
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
