/* Whisper (sherpa-onnx export) running on onnxruntime-web, fully local.
   Shared by the browser worker and the Node test harness. */
(function (root) {
  'use strict';
  const SR = 16000, NFFT = 400, HOP = 160, NBIN = 201;
  let NMEL = 80;
  const C_V2 = {
    sot: 50258, eot: 50257, transcribe: 50359, translate: 50358, noTs: 50363,
    noSpeech: 50362, sotPrev: 50361, sotLm: 50360, blank: 220, tsBegin: 50364, vocab: 51865, ctx: 448
  };
  /* large-v3 family (turbo): one extra language token shifts every special id by one */
  const C_V3 = {
    sot: 50258, eot: 50257, transcribe: 50360, translate: 50359, noTs: 50364,
    noSpeech: 50363, sotPrev: 50362, sotLm: 50361, blank: 220, tsBegin: 50365, vocab: 51866, ctx: 448
  };
  const C = Object.assign({}, C_V2);
  const LANG = {
    pt: 50267, en: 50259, es: 50262, fr: 50265, it: 50274, de: 50261
  };
  const NON_SPEECH = [1, 2, 7, 8, 9, 10, 14, 25, 26, 27, 28, 29, 31, 58, 59, 60, 61, 62, 63, 90, 91, 92, 93, 359, 503, 522, 542, 873, 893, 902, 918, 922, 931, 1350, 1853, 1982, 2460, 2627, 3246, 3253, 3268, 3536, 3846, 3961, 4183, 4667, 6585, 6647, 7273, 9061, 9383, 10428, 10929, 11938, 12033, 12331, 12562, 13793, 14157, 14635, 15265, 15618, 16553, 16604, 18362, 18956, 20075, 21675, 22520, 26130, 26161, 26435, 28279, 29464, 31650, 32302, 32470, 36865, 42863, 47425, 49870, 50254];
  const MODEL_DIMS = {
    tiny: { layers: 4, state: 384, mels: 80, v3: false, pad: 300 },
    base: { layers: 6, state: 512, mels: 80, v3: false, pad: 300 },
    small: { layers: 12, state: 768, mels: 80, v3: false, pad: 300 },
    turbo: { layers: 4, state: 1280, mels: 128, v3: true, pad: 1000 } // turbo loops on short padding
  };
  let PAD = 300;
  /* Switch constants and mel tables to the given model family. */
  function configure(name) {
    const d = MODEL_DIMS[name] || MODEL_DIMS.base;
    Object.assign(C, d.v3 ? C_V3 : C_V2);
    if (d.mels !== NMEL) { NMEL = d.mels; MEL = null; MLO = null; MHI = null; }
    PAD = d.pad || 300;
    return d;
  }

  /* ---------- log-mel features (Whisper-compatible) ---------- */
  let MEL = null, WIN = null, MLO = null, MHI = null;
  function slaneyHzToMel(f) {
    const fsp = 200 / 3, minLogHz = 1000, minLogMel = minLogHz / fsp, step = Math.log(6.4) / 27;
    return f >= minLogHz ? minLogMel + Math.log(f / minLogHz) / step : f / fsp;
  }
  function slaneyMelToHz(m) {
    const fsp = 200 / 3, minLogHz = 1000, minLogMel = minLogHz / fsp, step = Math.log(6.4) / 27;
    return m >= minLogMel ? minLogHz * Math.exp(step * (m - minLogMel)) : fsp * m;
  }
  function initTables() {
    if (MEL) return;
    const lo = slaneyHzToMel(0), hi = slaneyHzToMel(SR / 2);
    const pts = new Float64Array(NMEL + 2);
    for (let i = 0; i < NMEL + 2; i++) pts[i] = slaneyMelToHz(lo + (hi - lo) * i / (NMEL + 1));
    MEL = new Float32Array(NMEL * NBIN);
    for (let m = 0; m < NMEL; m++) {
      const enorm = 2 / (pts[m + 2] - pts[m]);
      for (let k = 0; k < NBIN; k++) {
        const f = k * SR / NFFT;
        const lower = (f - pts[m]) / (pts[m + 1] - pts[m]);
        const upper = (pts[m + 2] - f) / (pts[m + 2] - pts[m + 1]);
        MEL[m * NBIN + k] = Math.max(0, Math.min(lower, upper)) * enorm;
      }
    }
    MLO = new Int32Array(NMEL); MHI = new Int32Array(NMEL);
    for (let m = 0; m < NMEL; m++) { let lo = NBIN, hi = 0; for (let k = 0; k < NBIN; k++) if (MEL[m * NBIN + k] > 0) { if (k < lo) lo = k; hi = k + 1; } MLO[m] = lo < NBIN ? lo : 0; MHI[m] = hi; }
    WIN = new Float32Array(NFFT);
    for (let n = 0; n < NFFT; n++) WIN[n] = 0.5 - 0.5 * Math.cos(2 * Math.PI * n / NFFT);
  }

  /* Mixed-radix Stockham FFT for N = 400 = 4*4*5*5 (about 10x faster than a direct DFT) */
  const RADICES = [4, 4, 5, 5];
  let FFT = null;
  function initFFT() {
    if (FFT) return;
    const stages = []; let n = NFFT, s = 1;
    for (const p of RADICES) {
      const m = n / p;
      const twr = new Float64Array(m * p), twi = new Float64Array(m * p);
      for (let q = 0; q < m; q++) for (let r = 0; r < p; r++) { const a = -2 * Math.PI * q * r / n; twr[q * p + r] = Math.cos(a); twi[q * p + r] = Math.sin(a); }
      const rr = new Float64Array(p * p), ri = new Float64Array(p * p);
      for (let j = 0; j < p; j++) for (let r = 0; r < p; r++) { const a = -2 * Math.PI * j * r / p; rr[j * p + r] = Math.cos(a); ri[j * p + r] = Math.sin(a); }
      stages.push({ p, m, n, s, twr, twi, rr, ri });
      n = m; s *= p;
    }
    FFT = { stages, xr: new Float64Array(NFFT), xi: new Float64Array(NFFT), yr: new Float64Array(NFFT), yi: new Float64Array(NFFT), ar: new Float64Array(5), ai: new Float64Array(5) };
  }
  function fft400(input, outPow) {
    const F = FFT; let xr = F.xr, xi = F.xi, yr = F.yr, yi = F.yi; const ar = F.ar, ai = F.ai;
    for (let i = 0; i < NFFT; i++) { xr[i] = input[i]; xi[i] = 0; }
    for (const st of F.stages) {
      const { p, m, s, twr, twi, rr, ri } = st;
      for (let q = 0; q < m; q++) {
        for (let k = 0; k < s; k++) {
          for (let j = 0; j < p; j++) { const idx = k + s * (q + m * j); ar[j] = xr[idx]; ai[j] = xi[idx]; }
          for (let r = 0; r < p; r++) {
            let sr = 0, si = 0;
            for (let j = 0; j < p; j++) { const cr = rr[j * p + r], ci = ri[j * p + r]; sr += ar[j] * cr - ai[j] * ci; si += ar[j] * ci + ai[j] * cr; }
            const wr = twr[q * p + r], wi = twi[q * p + r];
            const o = k + s * (p * q + r);
            yr[o] = sr * wr - si * wi; yi[o] = sr * wi + si * wr;
          }
        }
      }
      let t = xr; xr = yr; yr = t; t = xi; xi = yi; yi = t;
    }
    for (let k = 0; k < NBIN; k++) outPow[k] = xr[k] * xr[k] + xi[k] * xi[k];
  }

  /* Returns Float32Array laid out [NMEL][frames] of raw log10 power, and frames */
  function logMelRaw(pcm) {
    initTables(); initFFT();
    const pad = NFFT / 2, len = pcm.length;
    const frames = Math.floor(len / HOP);
    const out = new Float32Array(NMEL * Math.max(frames, 1));
    const buf = new Float32Array(NFFT), pow = new Float64Array(NBIN);
    for (let t = 0; t < frames; t++) {
      const s0 = t * HOP - pad;
      for (let n = 0; n < NFFT; n++) {
        let i = s0 + n;
        if (i < 0) i = -i; else if (i >= len) i = 2 * len - 2 - i; // reflect
        if (i < 0 || i >= len) i = 0;
        buf[n] = (pcm[i] || 0) * WIN[n];
      }
      fft400(buf, pow);
      for (let m = 0; m < NMEL; m++) {
        let sum = 0; const base = m * NBIN;
        for (let k = MLO[m], e = MHI[m]; k < e; k++) sum += MEL[base + k] * pow[k];
        out[m * frames + t] = Math.log10(Math.max(sum, 1e-10));
      }
    }
    return { data: out, frames };
  }

  /* Encoder input for one chunk (<= ~29 s of audio): normalized log-mel with zero tail, [1,80,T] */
  function chunkFeatures(pcm) {
    const { data, frames } = logMelRaw(pcm);
    let mx = -Infinity;
    for (let i = 0; i < data.length; i++) if (data[i] > mx) mx = data[i];
    const floor = mx - 8;
    let content = Math.min(frames, 2950);
    const T = Math.min(3000, content + (root.__PAD || PAD));
    const mel = new Float32Array(NMEL * T); // zeros = padding
    for (let m = 0; m < NMEL; m++) for (let t = 0; t < content; t++) {
      mel[m * T + t] = (Math.max(data[m * frames + t], floor) + 4) / 4;
    }
    return { mel, T, content };
  }

  /* ---------- tokens ---------- */
  function parseTokens(text) {
    const table = new Array(C.vocab);
    const lines = text.split('\n');
    for (const line of lines) {
      const sp = line.lastIndexOf(' ');
      if (sp < 0) continue;
      const id = parseInt(line.slice(sp + 1), 10);
      const b64 = line.slice(0, sp);
      let bin;
      try { bin = atob(b64); } catch (e) { bin = ''; }
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      table[id] = bytes;
    }
    return table;
  }
  function detok(table, ids) {
    let n = 0; for (const id of ids) if (id < C.eot && table[id]) n += table[id].length;
    const out = new Uint8Array(n); let o = 0;
    for (const id of ids) if (id < C.eot && table[id]) { out.set(table[id], o); o += table[id].length; }
    return new TextDecoder('utf-8').decode(out);
  }

  /* ---------- decoding ---------- */
  function lastRow(logits, V) {
    const d = logits.data, n = d.length / V;
    return Float32Array.from(d.subarray((n - 1) * V, n * V));
  }

  function applyRules(l, seq, maxTs) {
    const NEG = -Infinity;
    l[C.noTs] = NEG; l[C.sot] = NEG; l[C.sotPrev] = NEG; l[C.sotLm] = NEG; l[C.noSpeech] = NEG;
    l[C.translate] = NEG; l[C.transcribe] = NEG;
    for (let i = C.eot + 1; i < C.tsBegin; i++) l[i] = NEG; // language + task tokens
    for (const t of NON_SPEECH) l[t] = NEG;
    if (seq.length === 0) { l[C.blank] = NEG; l[C.eot] = NEG; }
    const last = seq.length ? seq[seq.length - 1] : -1;
    const lastTs = seq.length >= 1 && last >= C.tsBegin;
    const penTs = seq.length < 2 || seq[seq.length - 2] >= C.tsBegin;
    if (lastTs) {
      if (penTs) for (let i = C.tsBegin; i < C.vocab; i++) l[i] = NEG;
      else for (let i = 0; i < C.eot; i++) l[i] = NEG;
    }
    let lastTsTok = -1;
    for (let i = seq.length - 1; i >= 0; i--) if (seq[i] >= C.tsBegin) { lastTsTok = seq[i]; break; }
    if (lastTsTok >= 0) {
      const lim = (lastTs && !penTs) ? lastTsTok : lastTsTok + 1;
      for (let i = C.tsBegin; i < lim; i++) l[i] = NEG;
    }
    if (seq.length === 0) {
      for (let i = 0; i < C.tsBegin; i++) l[i] = NEG;
      for (let i = C.tsBegin + 51; i < C.vocab; i++) l[i] = NEG; // first timestamp <= 1 s
    }
    if (maxTs) for (let i = C.tsBegin + maxTs + 1; i < C.vocab; i++) l[i] = NEG;
    // if total probability of timestamps beats any single text token, pick a timestamp
    let mx = NEG; for (let i = 0; i < C.vocab; i++) if (l[i] > mx) mx = l[i];
    let sumAll = 0; for (let i = 0; i < C.vocab; i++) if (l[i] !== NEG) sumAll += Math.exp(l[i] - mx);
    const lse = mx + Math.log(sumAll);
    let tsSum = 0; for (let i = C.tsBegin; i < C.vocab; i++) if (l[i] !== NEG) tsSum += Math.exp(l[i] - mx);
    const tsLog = tsSum > 0 ? mx + Math.log(tsSum) - lse : NEG;
    let maxText = NEG; for (let i = 0; i < C.tsBegin; i++) if (l[i] > maxText) maxText = l[i];
    maxText -= lse;
    if (tsLog > maxText) for (let i = 0; i < C.tsBegin; i++) l[i] = NEG;
  }

  function argmax(a) { let b = 0, v = -Infinity; for (let i = 0; i < a.length; i++) if (a[i] > v) { v = a[i]; b = i; } return b; }

  async function createSessions(ort, encBytes, decBytes, modelName, sessionOptions) {
    const dims = configure(modelName);
    const opts = sessionOptions || { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
    const enc = await ort.InferenceSession.create(encBytes, opts);
    const dec = await ort.InferenceSession.create(decBytes, opts);
    return { enc, dec, dims, name: modelName };
  }

  async function runDecoder(ort, S, tokens, kc, vc, ck, cv, offset) {
    const feeds = {
      tokens: new ort.Tensor('int64', BigInt64Array.from(tokens.map(BigInt)), [1, tokens.length]),
      in_n_layer_self_k_cache: kc, in_n_layer_self_v_cache: vc,
      n_layer_cross_k: ck, n_layer_cross_v: cv,
      offset: new ort.Tensor('int64', BigInt64Array.from([BigInt(offset)]), [1])
    };
    const r = await S.dec.run(feeds);
    return r;
  }

  function emptyCache(ort, S) {
    const { layers, state } = S.dims;
    const n = layers * C.ctx * state;
    return [new ort.Tensor('float32', new Float32Array(n), [layers, 1, C.ctx, state]),
            new ort.Tensor('float32', new Float32Array(n), [layers, 1, C.ctx, state])];
  }

  async function detectLanguage(ort, S, ck, cv) {
    const [kc, vc] = emptyCache(ort, S);
    const r = await runDecoder(ort, S, [C.sot], kc, vc, ck, cv, 0);
    const l = lastRow(r.logits, C.vocab);
    let best = 'pt', bv = -Infinity;
    for (const [code, id] of Object.entries(LANG)) if (l[id] > bv) { bv = l[id]; best = code; }
    return best;
  }

  /* Transcribe one chunk of 16 kHz PCM (<= 29 s). Returns segments relative to chunk start. */
  async function transcribeChunk(ort, S, table, pcm, lang) {
    const dur = pcm.length / SR;
    const { mel, T } = chunkFeatures(pcm);
    const enc = await S.enc.run({ mel: new ort.Tensor('float32', mel, [1, NMEL, T]) });
    const ck = enc.n_layer_cross_k, cv = enc.n_layer_cross_v;
    if (lang === 'auto') lang = await detectLanguage(ort, S, ck, cv);
    let [kc, vc] = emptyCache(ort, S);
    const prompt = [C.sot, LANG[lang] || LANG.pt, C.transcribe];
    let r = await runDecoder(ort, S, prompt, kc, vc, ck, cv, 0);
    let offset = prompt.length;
    const seq = [];
    const maxTs = Math.min(1500, Math.ceil(dur / 0.02) + 5);
    const closed = []; let openTs = -1;
    for (let step = 0; step < 224; step++) {
      const l = lastRow(r.logits, C.vocab);
      applyRules(l, seq, maxTs);
      const tok = argmax(l);
      if (tok === C.eot) break;
      if (tok >= C.tsBegin) {
        const prev = seq.length ? seq[seq.length - 1] : -1;
        if (prev >= 0 && prev < C.eot && openTs >= 0) {
          // closing a segment: a repeat of an earlier one means the model is looping
          const key = seq.slice(openTs + 1).join(',');
          if (closed.includes(key)) { seq.length = openTs; break; }
          closed.push(key);
        } else openTs = seq.length;
      }
      seq.push(tok);
      if (repeating(seq)) break;
      kc = r.out_n_layer_self_k_cache; vc = r.out_n_layer_self_v_cache;
      r = await runDecoder(ort, S, [tok], kc, vc, ck, cv, offset);
      offset++;
      if (offset >= C.ctx - 1) break;
    }
    return { segments: toSegments(table, seq, dur), lang };
  }

  function repeating(seq) {
    const n = seq.length;
    if (n < 40) return false;
    for (const w of [4, 6, 8, 12]) {
      if (n < w * 4) continue;
      let rep = true;
      for (let k = 1; k < 4 && rep; k++) for (let i = 0; i < w; i++) if (seq[n - 1 - i] !== seq[n - 1 - i - k * w]) { rep = false; break; }
      if (rep) return true;
    }
    return false;
  }

  function toSegments(table, seq, dur) {
    const segs = [];
    let start = 0, toks = [];
    for (const t of seq) {
      if (t >= C.tsBegin) {
        const time = (t - C.tsBegin) * 0.02;
        if (toks.length) { segs.push({ start, end: Math.max(time, start + 0.1), toks }); toks = []; }
        start = time;
      } else toks.push(t);
    }
    if (toks.length) segs.push({ start, end: Math.max(dur, start + 0.2), toks });
    const out = [];
    for (const s of segs) {
      const text = detok(table, s.toks).replace(/\s+/g, ' ').trim();
      if (!text || /amara\.org|legendas pela comunidade/i.test(text)) continue;
      out.push({ start: Math.min(s.start, dur), end: Math.min(s.end, dur), text });
    }
    return out;
  }

  /* Split words over a segment's time span, weighted by length. */
  function wordsFor(seg) {
    const parts = seg.text.split(/\s+/).filter(Boolean);
    const weights = parts.map(p => p.replace(/[^\p{L}\p{N}]/gu, '').length + 1.5);
    const total = weights.reduce((a, b) => a + b, 0) || 1;
    const span = Math.max(0.05, seg.end - seg.start);
    let t = seg.start;
    return parts.map((w, i) => {
      const d = span * weights[i] / total;
      const o = { w, start: t, end: t + d };
      t += d; return o;
    });
  }

  /* ---------- audio analysis ---------- */
  /* 20 ms RMS envelope in dB */
  function envelope(pcm, sr) {
    const hop = Math.round(sr * 0.02), n = Math.floor(pcm.length / hop);
    const db = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let s = 0; const o = i * hop;
      for (let j = 0; j < hop; j++) { const v = pcm[o + j]; s += v * v; }
      db[i] = 10 * Math.log10(s / hop + 1e-12);
    }
    return db;
  }

  function percentile(arr, p) {
    const a = Float32Array.from(arr).sort();
    return a[Math.min(a.length - 1, Math.max(0, Math.floor(a.length * p)))];
  }

  /* Plan ASR chunks (<= maxLen s) that start and end in pauses. */
  function planChunks(pcm, maxLen) {
    maxLen = maxLen || 28;
    const env = envelope(pcm, SR); // 20 ms frames
    const n = env.length;
    const floor = percentile(env, 0.1), peak = percentile(env, 0.98);
    const thr = Math.max(floor + (peak - floor) * 0.25, -55);
    const speech = new Uint8Array(n);
    for (let i = 0; i < n; i++) speech[i] = env[i] > thr ? 1 : 0;
    // close tiny gaps (< 200 ms) and drop blips (< 100 ms)
    fill(speech, 0, 10, 1); fill(speech, 1, 5, 0);
    const chunks = [];
    const maxF = Math.round(maxLen / 0.02);
    let i = 0;
    while (i < n) {
      while (i < n && !speech[i]) i++;
      if (i >= n) break;
      let start = Math.max(0, i - 10); // 200 ms lead-in
      let end = start;
      // extend until max length, preferring to end at the longest pause
      let j = i, bestCut = -1, bestGap = 0, gap = 0;
      while (j < n && j - start < maxF) {
        if (!speech[j]) { gap++; if (gap >= bestGap && j - start > maxF * 0.4) { bestGap = gap; bestCut = j - Math.floor(gap / 2); } if (gap > 60) break; }
        else gap = 0;
        j++;
      }
      if (j >= n || gap > 60) end = Math.min(n, j - gap + 10);
      else end = bestCut > 0 ? bestCut : j;
      chunks.push({ start: start * 0.02, end: end * 0.02 });
      i = Math.max(end, i + 1);
    }
    return chunks;
  }
  function fill(a, val, maxRun, to) {
    let i = 0; const n = a.length;
    while (i < n) {
      if (a[i] === val) { let j = i; while (j < n && a[j] === val) j++; if (i > 0 && j < n && j - i < maxRun) for (let k = i; k < j; k++) a[k] = to; i = j; }
      else i++;
    }
  }

  async function transcribe(ort, S, table, pcm, opts) {
    opts = opts || {};
    const lang = opts.lang || 'pt';
    const chunks = opts.chunks || planChunks(pcm, 28);
    const segments = [];
    let detected = lang === 'auto' ? null : lang;
    const t0 = Date.now();
    for (let c = 0; c < chunks.length; c++) {
      const ch = chunks[c];
      const a = Math.floor(ch.start * SR), b = Math.min(pcm.length, Math.floor(ch.end * SR));
      if (b - a < SR * 0.3) continue;
      const res = await transcribeChunk(ort, S, table, pcm.subarray(a, b), detected || 'auto');
      detected = detected || res.lang;
      for (const s of res.segments) {
        const seg = { start: +(ch.start + s.start).toFixed(3), end: +(ch.start + s.end).toFixed(3), text: s.text };
        seg.words = wordsFor(seg);
        segments.push(seg);
        if (opts.onSegment) opts.onSegment(seg);
      }
      if (opts.onProgress) opts.onProgress({ done: c + 1, total: chunks.length, audioSec: ch.end, elapsed: (Date.now() - t0) / 1000 });
    }
    return { segments, lang: detected };
  }

  root.WhisperCore = { SR, C, LANG, MODEL_DIMS, configure, logMelRaw, chunkFeatures, parseTokens, detok, createSessions, transcribeChunk, transcribe, planChunks, envelope, wordsFor, percentile };
})(typeof self !== 'undefined' ? self : globalThis);
