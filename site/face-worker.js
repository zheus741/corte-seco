/* Corte Seco — face finder for automatic reframing (UltraFace RFB-320, MIT). Runs off the main thread. */
let S = null;
const IW = 320, IH = 240;
self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === 'init') {
      importScripts(m.base + 'ort/ort.wasm.min.js');
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
      ort.env.wasm.wasmPaths = m.base + 'ort/';
      if (m.wasmBinary) ort.env.wasm.wasmBinary = m.wasmBinary;
      S = await ort.InferenceSession.create(new Uint8Array(m.model), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
      self.postMessage({ type: 'ready' });
    } else if (m.type === 'detect') {
      const px = new Uint8ClampedArray(m.rgba); // IW*IH*4
      const x = new Float32Array(3 * IW * IH), n = IW * IH;
      for (let i = 0; i < n; i++) { x[i] = (px[i * 4] - 127) / 128; x[n + i] = (px[i * 4 + 1] - 127) / 128; x[2 * n + i] = (px[i * 4 + 2] - 127) / 128; }
      const r = await S.run({ input: new ort.Tensor('float32', x, [1, 3, IH, IW]) });
      const sc = r.scores.data, bx = r.boxes.data, cand = [];
      for (let i = 0; i < sc.length / 2; i++) { const s = sc[i * 2 + 1]; if (s > 0.72) cand.push({ s, x1: bx[i * 4], y1: bx[i * 4 + 1], x2: bx[i * 4 + 2], y2: bx[i * 4 + 3] }); }
      cand.sort((a, b) => b.s - a.s);
      const keep = [];
      const iou = (a, b) => { const w = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)), h = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1)), i = w * h; return i / ((a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - i + 1e-9); };
      for (const c of cand) { if (keep.length >= 6) break; if (keep.every(k => iou(k, c) < 0.3)) keep.push(c); }
      self.postMessage({ type: 'faces', id: m.id, faces: keep.map(k => ({ cx: (k.x1 + k.x2) / 2, cy: (k.y1 + k.y2) / 2, w: k.x2 - k.x1, h: k.y2 - k.y1, s: +k.s.toFixed(3) })) });
    }
  } catch (err) {
    self.postMessage({ type: 'error', id: m.id, message: String(err && err.message || err) });
  }
};
