/* Corte Seco — desktop shell (Electron).
   Serves the same editor used on the web from app://, adds native Whisper transcription,
   direct file access, model downloads and an optional Claude API bridge. */
'use strict';
const { app, BrowserWindow, protocol, net, ipcMain, dialog, shell, utilityProcess, Menu, webContents } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const http = require('http');
const { pathToFileURL } = require('url');
const { spawn, execFile } = require('child_process');
const zlib = require('zlib');
const crypto = require('crypto');

const APP_DIR = path.join(__dirname, 'app');
const unpacked = (p) => p.replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
const MODELS_BUNDLED = unpacked(path.join(APP_DIR, 'models'));
const CORE_FILE = unpacked(path.join(APP_DIR, 'asr-core.js'));
const HOST_FILE = unpacked(path.join(__dirname, 'engine', 'asr-host.js'));
const isMac = process.platform === 'darwin';

app.setName('Corte Seco');
if (!app.requestSingleInstanceLock()) { app.quit(); }
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } }]);

/* ---------------- settings ---------------- */
const SETTINGS_FILE = () => path.join(app.getPath('userData'), 'settings.json');
let settings = {};
function loadSettings() { try { settings = JSON.parse(fs.readFileSync(SETTINGS_FILE(), 'utf8')); } catch (e) { settings = {}; } }
function saveSettings() { try { fs.mkdirSync(path.dirname(SETTINGS_FILE()), { recursive: true }); fs.writeFileSync(SETTINGS_FILE(), JSON.stringify(settings, null, 2)); } catch (e) {} }
function defaultOutDir() {
  const base = isMac ? app.getPath('movies') : app.getPath('videos');
  return path.join(base || app.getPath('documents'), 'Corte Seco');
}
function outDir() { return settings.outDir || defaultOutDir(); }

/* ---------------- models ---------------- */
const HF = process.env.CS_MODEL_BASE || 'https://huggingface.co/csukuangfj';
const MODELS = {
  base: { label: 'Rápida', note: 'Já vem instalado', bundled: true },
  small: { label: 'Precisa', bytes: 112442483 + 262226114, files: [
    { name: 'encoder.onnx', url: `${HF}/sherpa-onnx-whisper-small/resolve/main/small-encoder.int8.onnx`, bytes: 112442483 },
    { name: 'decoder.onnx', url: `${HF}/sherpa-onnx-whisper-small/resolve/main/small-decoder.int8.onnx`, bytes: 262226114 }] },
  turbo: { label: 'Máxima', bytes: 674716297 + 361080764, files: [
    { name: 'encoder.onnx', url: `${HF}/sherpa-onnx-whisper-turbo/resolve/main/turbo-encoder.int8.onnx`, bytes: 674716297 },
    { name: 'decoder.onnx', url: `${HF}/sherpa-onnx-whisper-turbo/resolve/main/turbo-decoder.int8.onnx`, bytes: 361080764 }] }
};
const modelDir = (id) => path.join(app.getPath('userData'), 'models', id);
function modelInstalled(id) {
  const m = MODELS[id]; if (!m) return false;
  if (m.bundled) return true;
  return m.files.every((f) => { try { return fs.statSync(path.join(modelDir(id), f.name)).size === f.bytes; } catch (e) { return false; } });
}
function nativeAvailable() {
  if (process.env.CS_NO_NATIVE) return false;
  const p = unpacked(path.join(__dirname, 'node_modules', 'onnxruntime-node', 'bin', 'napi-v6', process.platform, process.arch, 'onnxruntime_binding.node'));
  return fs.existsSync(p);
}
function bundledPaths(prefix) {
  return fs.readdirSync(MODELS_BUNDLED).filter((f) => f.startsWith(prefix + '.')).sort((a, b) => parseInt(a.split('.')[1]) - parseInt(b.split('.')[1])).map((f) => path.join(MODELS_BUNDLED, f));
}
function modelFiles(id) {
  if (id === 'base') return { enc: bundledPaths('base-enc'), dec: bundledPaths('base-decf') };
  return { enc: path.join(modelDir(id), 'encoder.onnx'), dec: path.join(modelDir(id), 'decoder.onnx') };
}
function poolSize(id) {
  const cores = Math.max(1, os.cpus().length), memGB = os.totalmem() / 2 ** 30;
  let workers;
  if (id === 'turbo') workers = memGB >= 24 && cores >= 8 ? 2 : 1;
  else if (id === 'small') workers = Math.max(1, Math.min(3, Math.floor(cores / 3), Math.floor(memGB / 4)));
  else workers = Math.max(1, Math.min(4, Math.floor(cores / 2)));
  return { workers, threads: Math.max(1, Math.floor(cores / workers)) };
}

let dl = null; // active download {id, req, cancelled}
function download(id, send) {
  const m = MODELS[id];
  if (!m || m.bundled) return Promise.resolve(true);
  if (dl) return Promise.reject(new Error('Já tem um download em andamento.'));
  const dir = modelDir(id); fs.mkdirSync(dir, { recursive: true });
  const total = m.bytes; let before = 0; // bytes of files already finished
  dl = { id, cancelled: false, req: null };
  const attempt = (f) => new Promise((resolve, reject) => {
    const final = path.join(dir, f.name), tmp = final + '.part';
    let have = 0; try { have = fs.statSync(tmp).size; } catch (e) {}
    if (have > f.bytes) { try { fs.unlinkSync(tmp); } catch (e) {} have = 0; }
    let settled = false; const ok = () => { if (!settled) { settled = true; resolve(); } }, fail = (e) => { if (!settled) { settled = true; reject(e); } };
    const get = (url, hops) => {
      const req = (url.startsWith('http:') ? http : https).get(url, { headers: Object.assign({ 'User-Agent': 'CorteSeco/' + app.getVersion() }, have ? { Range: `bytes=${have}-` } : {}) }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && hops < 8) { res.resume(); return get(new URL(res.headers.location, url).href, hops + 1); }
        if (res.statusCode === 200) have = 0; // the server ignored the range: start over
        else if (res.statusCode !== 206) { res.resume(); return fail(new Error('download HTTP ' + res.statusCode)); }
        let got = have;
        const out = fs.createWriteStream(tmp, { flags: have ? 'a' : 'w' });
        res.on('data', (b) => { got += b.length; send({ id, done: before + got, total }); });
        res.on('aborted', () => fail(new Error('conexão interrompida')));
        res.on('error', fail); out.on('error', fail);
        res.pipe(out);
        out.on('finish', () => {
          try { const sz = fs.statSync(tmp).size; if (sz !== f.bytes) return fail(new Error(`arquivo incompleto (${sz} de ${f.bytes})`)); fs.renameSync(tmp, final); ok(); } catch (e) { fail(e); }
        });
      });
      req.setTimeout(60000, () => req.destroy(new Error('sem resposta do servidor')));
      req.on('error', fail);
      dl.req = req;
    };
    get(f.url, 0);
  });
  const one = async (f) => {
    const final = path.join(dir, f.name);
    try { if (fs.statSync(final).size === f.bytes) { before += f.bytes; return; } } catch (e) {}
    for (let i = 0; ; i++) {
      if (dl.cancelled) throw new Error('cancelado');
      try { await attempt(f); before += f.bytes; return; }
      catch (e) { if (dl.cancelled || i >= 5) throw e; await new Promise((r) => setTimeout(r, 1500 * (i + 1))); } // resume where it stopped
    }
  };
  return (async () => {
    try { for (const f of m.files) await one(f); send({ id, done: total, total, finished: true }); return true; }
    finally { dl = null; }
  })();
}

/* ---------------- transcription host ---------------- */
let host = null, hostReady = null, hostLoaded = null;
const pending = new Map(); let seq = 0;
let loadWaiter = null;
function ensureHost() {
  if (host) return hostReady;
  host = utilityProcess.fork(HOST_FILE, [], { serviceName: 'Corte Seco — transcrição', stdio: 'inherit' });
  hostReady = new Promise((res) => { host.once('spawn', res); });
  host.on('message', (m) => {
    if (m.type === 'chunk' || (m.type === 'error' && m.id != null && pending.has(m.id))) {
      const p = pending.get(m.id); pending.delete(m.id);
      if (!p) return;
      if (m.type === 'chunk') p.resolve({ segments: m.segments, lang: m.lang, ms: m.ms }); else p.reject(new Error(m.message));
    } else if (m.type === 'loaded' && loadWaiter) { const w = loadWaiter; loadWaiter = null; w.resolve(m); }
    else if (m.type === 'error' && loadWaiter) { const w = loadWaiter; loadWaiter = null; w.reject(new Error(m.message)); }
    else if (m.type === 'pool') { for (const wc of webContents.getAllWebContents()) wc.send('asr:pool', m.workers); }
  });
  host.on('exit', (code) => {
    host = null; hostLoaded = null;
    for (const p of pending.values()) p.reject(new Error('o motor de transcrição fechou (' + code + ')'));
    pending.clear();
    if (loadWaiter) { loadWaiter.reject(new Error('o motor de transcrição fechou (' + code + ')')); loadWaiter = null; }
  });
  return hostReady;
}
async function loadModel(id) {
  if (!modelInstalled(id)) throw new Error('modelo não instalado');
  await ensureHost();
  const f = modelFiles(id), ps = poolSize(id);
  const key = id + JSON.stringify(ps);
  const p = new Promise((resolve, reject) => { loadWaiter = { resolve, reject }; });
  host.postMessage({ type: 'load', model: id, enc: f.enc, dec: f.dec, tokens: path.join(MODELS_BUNDLED, 'tokens.txt'), coreFile: CORE_FILE, workers: ps.workers, threads: ps.threads });
  const r = await p; hostLoaded = key;
  return { model: id, workers: ps.workers, threads: ps.threads, ms: r.ms };
}

/* ---------------- files ---------------- */
const handles = new Map(); let hseq = 1;
function uniquePath(dir, name) {
  const ext = path.extname(name), stem = name.slice(0, name.length - ext.length);
  let p = path.join(dir, name), n = 2;
  while (fs.existsSync(p)) p = path.join(dir, `${stem} (${n++})${ext}`);
  return p;
}
const safeName = (s) => String(s || 'arquivo').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').slice(0, 150);

/* ---------------- Claude API (optional, user's own key) ---------------- */
function claude({ key, prompt, model, maxTokens }) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ model: model || 'claude-sonnet-4-5', max_tokens: maxTokens || 4000, messages: [{ role: 'user', content: prompt }] });
    const req = https.request('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-length': Buffer.byteLength(body) } }, (res) => {
      let d = ''; res.setEncoding('utf8'); res.on('data', (c) => (d += c));
      res.on('end', () => {
        try {
          const j = JSON.parse(d);
          if (res.statusCode >= 300) return reject(Object.assign(new Error((j.error && j.error.message) || ('HTTP ' + res.statusCode)), { status: res.statusCode }));
          resolve((j.content || []).filter((c) => c.type === 'text').map((c) => c.text).join(''));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject); req.write(body); req.end();
  });
}


/* ---------------- vídeo de um link (YouTube, Instagram, TikTok…) ----------------
   Usa o yt-dlp (baixado do GitHub na primeira vez, conferido pelo SHA-256 do próprio lançamento) e o ffmpeg
   (versão fixa, conferida por SHA-256) para juntar vídeo e som. O próprio Electron faz o papel de Node.js
   para o yt-dlp resolver os desafios do YouTube. */
const BIN_DIR = () => path.join(app.getPath('userData'), 'bin');
const EXE = process.platform === 'win32' ? '.exe' : '';
const ytPath = () => path.join(BIN_DIR(), 'yt-dlp' + EXE);
const ffPath = () => path.join(BIN_DIR(), 'ffmpeg' + EXE);
const YT_ASSET = { darwin: 'yt-dlp_macos', win32: process.arch === 'arm64' ? 'yt-dlp_arm64.exe' : 'yt-dlp.exe', linux: 'yt-dlp_linux' }[process.platform];
const YT_BASE = process.env.CS_YTDLP_BASE || 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/';
const FF_BASE = process.env.CS_FFMPEG_BASE || 'https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/';
const FF_ASSET = {
  'darwin-arm64': ['ffmpeg-darwin-arm64.gz', '8923876afa8db5585022d7860ec7e589af192f441c56793971276d450ed3bbfa', 19246198],
  'darwin-x64': ['ffmpeg-darwin-x64.gz', '929b375c1182d956c51f7ac25e0b2b0411fb01f6f407aa15c9758efeb4242106', 25296431],
  'win32-x64': ['ffmpeg-win32-x64.gz', '8883a3dffbd0a16cf4ef95206ea05283f78908dbfb118f73c83f4951dcc06d77', 29581307],
  'win32-arm64': ['ffmpeg-win32-x64.gz', '8883a3dffbd0a16cf4ef95206ea05283f78908dbfb118f73c83f4951dcc06d77', 29581307],
  'linux-x64': ['ffmpeg-linux-x64.gz', 'bfe8a8fc511530457b528c48d77b5737527b504a3797a9bc4866aeca69c2dffa', 29354986]
}[process.platform + '-' + process.arch];
function httpGet(url, onRes, hops = 0) {
  return new Promise((resolve, reject) => {
    const req = (url.startsWith('http:') ? http : https).get(url, { headers: { 'User-Agent': 'CorteSeco/' + app.getVersion() } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && hops < 8) { res.resume(); return resolve(httpGet(new URL(res.headers.location, url).href, onRes, hops + 1)); }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('download HTTP ' + res.statusCode)); }
      onRes(res, resolve, reject);
    });
    req.setTimeout(60000, () => req.destroy(new Error('sem resposta do servidor')));
    req.on('error', reject);
  });
}
const getText = (url) => httpGet(url, (res, ok, bad) => { let d = ''; res.setEncoding('utf8'); res.on('data', (c) => (d += c)); res.on('end', () => ok(d)); res.on('error', bad); });
function getFile(url, dest, { sha, gunzip, onBytes }) { // baixa, confere o SHA-256 do que veio e só então põe no lugar
  const tmp = dest + '.part';
  return httpGet(url, (res, ok, bad) => {
    const h = crypto.createHash('sha256'), out = fs.createWriteStream(tmp);
    res.on('data', (b) => { h.update(b); if (onBytes) onBytes(b.length, +res.headers['content-length'] || 0); });
    res.on('error', bad); out.on('error', bad);
    (gunzip ? res.pipe(zlib.createGunzip()).on('error', bad) : res).pipe(out);
    out.on('finish', () => {
      const got = h.digest('hex');
      if (sha && got !== sha) { try { fs.unlinkSync(tmp); } catch (e) {} return bad(new Error('o arquivo baixado não confere (SHA-256)')); }
      try { fs.chmodSync(tmp, 0o755); fs.renameSync(tmp, dest); ok(dest); } catch (e) { bad(e); }
    });
  });
}
let toolsP = null;
function ensureTools(send) {
  if (fs.existsSync(ytPath()) && fs.existsSync(ffPath())) return Promise.resolve(true);
  if (toolsP) return toolsP;
  toolsP = (async () => {
    if (!YT_ASSET || !FF_ASSET) throw new Error('baixar de links ainda não funciona neste sistema');
    fs.mkdirSync(BIN_DIR(), { recursive: true });
    const total = (fs.existsSync(ytPath()) ? 0 : 36e6) + (fs.existsSync(ffPath()) ? 0 : FF_ASSET[2]); let done = 0;
    const tick = (n) => { done += n; send({ phase: 'tools', done: Math.min(done, total), total }); };
    if (!fs.existsSync(ytPath())) {
      for (let i = 0; ; i++) { // "latest" pode mudar entre um pedido e outro: tenta de novo
        try {
          const sums = await getText(YT_BASE + 'SHA2-256SUMS');
          const line = sums.split('\n').find((l) => l.trim().endsWith('  ' + YT_ASSET)); if (!line) throw new Error('lançamento sem ' + YT_ASSET);
          await getFile(YT_BASE + YT_ASSET, ytPath(), { sha: line.split(/\s+/)[0], onBytes: tick });
          break;
        } catch (e) { if (i >= 2) throw e; await new Promise((r) => setTimeout(r, 1500)); }
      }
    }
    if (!fs.existsSync(ffPath())) await getFile(FF_BASE + FF_ASSET[0], ffPath(), { sha: FF_ASSET[1], gunzip: true, onBytes: tick });
    return true;
  })().finally(() => { toolsP = null; });
  return toolsP;
}
function ytArgs() { return ['--no-config', '--no-playlist', '--js-runtimes', 'node:' + process.execPath, '--ffmpeg-location', ffPath()]; }
const ytEnv = () => Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1', PYTHONIOENCODING: 'utf-8' });
function ytRun(args, onLine, job) {
  return new Promise((resolve, reject) => {
    const p = spawn(ytPath(), [...ytArgs(), ...args], { env: ytEnv(), windowsHide: true, detached: process.platform !== 'win32' });
    if (job) job.proc = p;
    let out = '', err = '', buf = '';
    p.stdout.setEncoding('utf8'); p.stderr.setEncoding('utf8');
    p.stdout.on('data', (d) => { out += d; buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (l && onLine) onLine(l); } });
    p.stderr.on('data', (d) => { err += d; if (onLine) for (const l of d.split('\n')) if (l.trim()) onLine(l.trim()); });
    p.on('error', reject);
    p.on('close', (code) => {
      if (job && job.cancelled) return reject(new Error('cancelado'));
      if (code === 0) return resolve(out);
      const m = (err.match(/ERROR: (.+)/g) || []).pop() || err.trim().split('\n').pop() || ('saiu com código ' + code);
      reject(new Error(m.replace(/^ERROR:\s*/, '').slice(0, 400)));
    });
  });
}
function killJob(job) {
  if (!job || !job.proc) return;
  job.cancelled = true;
  try { if (process.platform === 'win32') execFile('taskkill', ['/pid', String(job.proc.pid), '/T', '/F']); else process.kill(-job.proc.pid, 'SIGTERM'); } catch (e) { try { job.proc.kill(); } catch (_) {} }
}
async function ytUpdate(force) { // o YouTube muda sempre: o yt-dlp se atualiza a cada poucos dias
  try {
    const age = Date.now() - fs.statSync(ytPath()).mtimeMs;
    if (!force && age < 4 * 86400e3) return false;
    await Promise.race([ytRun(['-U'], null, null), new Promise((r) => setTimeout(r, 90000))]);
    const now = new Date(); fs.utimesSync(ytPath(), now, now);
    return true;
  } catch (e) { return false; }
}
let linkJob = null;
const downloadsDir = () => path.join(outDir(), 'Baixados');
async function linkInfo(url, send) {
  await ensureTools(send);
  await ytUpdate(false);
  send({ phase: 'info' });
  const job = linkJob = { cancelled: false, proc: null };
  try {
    const j = JSON.parse(await ytRun(['-J', '--no-warnings', url], null, job));
    const e = j.entries ? j.entries[0] || {} : j;
    return { title: e.title || j.title || '', duration: e.duration || 0, channel: e.channel || e.uploader || '', site: e.extractor_key || j.extractor_key || '', thumbnail: e.thumbnail || '', live: !!e.is_live, id: e.id || '' };
  } finally { if (linkJob === job) linkJob = null; }
}
async function linkGet(url, send, retried) {
  await ensureTools(send);
  const dir = downloadsDir(); fs.mkdirSync(dir, { recursive: true });
  const job = linkJob = { cancelled: false, proc: null }, t0 = Date.now() - 2000;
  let part = 0, lastFmt = null, final = '';
  const args = ['--newline', '--progress', '--no-mtime', '--windows-filenames', '--no-overwrites',
    '--progress-template', 'download:CSPROG %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s %(progress.speed)s %(progress.eta)s %(info.format_id)s',
    '-f', 'bv*[height<=1080]+ba/b[height<=1080]/bv*+ba/b', '-S', 'vcodec:h264,res:1080,acodec:aac', '--merge-output-format', 'mp4',
    '-o', path.join(dir, '%(title).90B [%(id)s].%(ext)s'), '--print', 'after_move:CSFILE %(filepath)s', url];
  try {
    await ytRun(args, (l) => {
      if (l.startsWith('CSPROG ')) {
        const [, d, t, te, sp, eta, fmt] = l.split(' ');
        if (fmt !== lastFmt) { lastFmt = fmt; part++; }
        const tot = +t || +te || 0;
        send({ phase: 'dl', part, done: +d || 0, total: tot, speed: +sp || 0, eta: +eta || 0 });
      } else if (l.startsWith('CSFILE ')) final = l.slice(7).trim();
      else if (/^\[Merger\]|^\[VideoConvertor\]|^\[ExtractAudio\]/.test(l)) send({ phase: 'merge' });
    }, job);
  } catch (e) {
    if (job.cancelled) { // cancelou: apaga os pedaços deste download (o resto da pasta fica como está)
      await new Promise((r) => setTimeout(r, 600));
      try { for (const f of fs.readdirSync(dir)) { const p = path.join(dir, f); if (/\.(part|ytdl|temp)$|\.part-Frag\d+/.test(f) && fs.statSync(p).mtimeMs >= t0) fs.rmSync(p, { force: true }); } } catch (_) {}
      throw e;
    }
    if (!retried && !/private|privado|sign in|login|age|idade|unsupported url|not available|indispon|HTTP Error 40[14]|HTTP Error 410/i.test(e.message) && await ytUpdate(true)) return linkGet(url, send, true);
    throw e;
  } finally { if (linkJob === job) linkJob = null; }
  if (!final || !fs.existsSync(final)) throw new Error('o download terminou, mas não achei o arquivo');
  return final;
}

/* ---------------- IPC ---------------- */
function registerIpc() {
  ipcMain.handle('info', () => ({ platform: process.platform, arch: process.arch, version: app.getVersion(), native: nativeAvailable(), cores: os.cpus().length, memGB: Math.round(os.totalmem() / 2 ** 30), outDir: outDir() }));
  ipcMain.handle('asr:models', () => Object.entries(MODELS).map(([id, m]) => ({ id, label: m.label, bytes: m.bytes || 0, bundled: !!m.bundled, installed: modelInstalled(id), pool: poolSize(id) })));
  ipcMain.handle('asr:download', async (e, id) => { const wc = e.sender; await download(id, (p) => { if (!wc.isDestroyed()) wc.send('asr:download', p); }); return modelInstalled(id); });
  ipcMain.handle('asr:cancelDownload', () => { if (dl) { dl.cancelled = true; try { dl.req && dl.req.destroy(new Error('cancelado')); } catch (e) {} } return true; });
  ipcMain.handle('asr:deleteModel', (e, id) => { if (MODELS[id] && !MODELS[id].bundled) fs.rmSync(modelDir(id), { recursive: true, force: true }); return true; });
  ipcMain.handle('asr:load', (e, id) => loadModel(id));
  ipcMain.handle('asr:chunk', async (e, { pcm, lang }) => {
    if (!host) throw new Error('motor não carregado');
    const id = ++seq;
    return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); host.postMessage({ type: 'chunk', id, pcm, lang }); });
  });
  ipcMain.handle('asr:cancel', () => { if (host) host.postMessage({ type: 'cancel' }); for (const p of pending.values()) p.reject(new Error('cancel')); pending.clear(); return true; });

  ipcMain.handle('settings:get', () => settings);
  ipcMain.handle('settings:set', (e, patch) => { Object.assign(settings, patch || {}); saveSettings(); return settings; });

  ipcMain.handle('files:outDir', () => outDir());
  ipcMain.handle('files:pickFolder', async (e) => {
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { title: 'Pasta onde os vídeos serão salvos', defaultPath: outDir(), properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    settings.outDir = r.filePaths[0]; saveSettings(); return settings.outDir;
  });
  ipcMain.handle('files:save', async (e, { name, data, sub }) => {
    const dir = sub ? path.join(outDir(), safeName(sub)) : outDir();
    fs.mkdirSync(dir, { recursive: true });
    const p = uniquePath(dir, safeName(name));
    await fs.promises.writeFile(p, Buffer.from(data.buffer ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data));
    return p;
  });
  ipcMain.handle('files:open', async (e, { name, sub }) => {
    const dir = sub ? path.join(outDir(), safeName(sub)) : outDir();
    fs.mkdirSync(dir, { recursive: true });
    const p = uniquePath(dir, safeName(name));
    const fd = await fs.promises.open(p, 'w');
    const h = hseq++; handles.set(h, { fd, p });
    return { handle: h, path: p };
  });
  ipcMain.handle('files:write', async (e, { handle, data, position }) => {
    const h = handles.get(handle); if (!h) throw new Error('arquivo fechado');
    const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    await h.fd.write(buf, 0, buf.length, position);
    return true;
  });
  ipcMain.handle('files:close', async (e, { handle, discard }) => {
    const h = handles.get(handle); if (!h) return null; handles.delete(handle);
    await h.fd.close();
    if (discard) { try { fs.unlinkSync(h.p); } catch (_) {} return null; }
    return h.p;
  });
  ipcMain.handle('files:reveal', (e, p) => { if (p && fs.existsSync(p)) shell.showItemInFolder(p); else shell.openPath(outDir()); return true; });
  ipcMain.handle('files:stat', (e, p) => { try { const s = fs.statSync(p); return { exists: s.isFile(), size: s.size, mtime: s.mtimeMs }; } catch (err) { return { exists: false }; } });
  ipcMain.handle('files:openFolder', () => { fs.mkdirSync(outDir(), { recursive: true }); shell.openPath(outDir()); return true; });
  ipcMain.handle('ai:claude', (e, args) => claude(args));
  const linkSend = (wc) => (p) => { if (!wc.isDestroyed()) wc.send('link:progress', p); };
  ipcMain.handle('link:info', (e, url) => linkInfo(String(url), linkSend(e.sender)));
  ipcMain.handle('link:get', (e, url) => linkGet(String(url), linkSend(e.sender)));
  ipcMain.handle('link:cancel', () => { if (linkJob) killJob(linkJob); return true; });
  ipcMain.handle('link:ready', () => fs.existsSync(ytPath()) && fs.existsSync(ffPath()));
  ipcMain.handle('app:openExternal', (e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return true; });
}

/* ---------------- app:// protocol ---------------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.wasm': 'application/wasm', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml' };
function registerProtocol() {
  protocol.handle('app', async (req) => {
    const u = new URL(req.url);
    if (u.pathname.startsWith('/__local/')) return localFile(u.pathname.slice(9));
    let rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.normalize(path.join(APP_DIR, rel));
    if (!file.startsWith(APP_DIR)) return new Response('no', { status: 403 });
    try {
      const res = await net.fetch(pathToFileURL(file).href);
      const headers = new Headers({
        'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'credentialless',
        'Cross-Origin-Resource-Policy': 'same-origin',
        'Cache-Control': 'no-cache'
      });
      return new Response(res.body, { status: 200, headers });
    } catch (e) { return new Response('not found', { status: 404 }); }
  });
}

/* media the user opened before (recent projects, b-roll, music) is read again straight from disk */
const LOCAL_EXT = /\.(mp4|mov|m4v|webm|mkv|avi|mp3|wav|m4a|aac|ogg|flac|png|jpe?g|webp|gif|avif)$/i;
async function localFile(seg) {
  let p = '';
  try { p = Buffer.from(seg, 'base64url').toString('utf8'); } catch (e) {}
  if (!p || !path.isAbsolute(p) || !LOCAL_EXT.test(p) || !fs.existsSync(p)) return new Response('not found', { status: 404 });
  try {
    const res = await net.fetch(pathToFileURL(p).href);
    const ext = path.extname(p).toLowerCase();
    const type = MIME[ext] || ({ '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif' })[ext] || 'application/octet-stream';
    return new Response(res.body, { status: 200, headers: { 'Content-Type': type, 'Content-Length': String(fs.statSync(p).size), 'Cross-Origin-Resource-Policy': 'same-origin', 'Cache-Control': 'no-store' } });
  } catch (e) { return new Response('not found', { status: 404 }); }
}

/* ---------------- window ---------------- */
let win = null;
function createWindow() {
  win = new BrowserWindow({
    width: 1480, height: 940, minWidth: 1080, minHeight: 680,
    backgroundColor: '#0E0F11', title: 'Corte Seco', show: false,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 14, y: 16 } : undefined,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false, backgroundThrottling: false, spellcheck: false }
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://')) e.preventDefault(); });
  win.loadURL('app://corte-seco/index.html');
}
function buildMenu() {
  const tpl = [
    ...(isMac ? [{ label: 'Corte Seco', submenu: [{ role: 'about', label: 'Sobre o Corte Seco' }, { type: 'separator' }, { role: 'hide', label: 'Ocultar' }, { role: 'hideOthers', label: 'Ocultar outros' }, { type: 'separator' }, { role: 'quit', label: 'Sair' }] }] : []),
    { label: 'Arquivo', submenu: [{ label: 'Abrir pasta de exportação', click: () => { fs.mkdirSync(outDir(), { recursive: true }); shell.openPath(outDir()); } }, { type: 'separator' }, isMac ? { role: 'close', label: 'Fechar janela' } : { role: 'quit', label: 'Sair' }] },
    { label: 'Editar', submenu: [{ role: 'undo', label: 'Desfazer' }, { role: 'redo', label: 'Refazer' }, { type: 'separator' }, { role: 'cut', label: 'Recortar' }, { role: 'copy', label: 'Copiar' }, { role: 'paste', label: 'Colar' }, { role: 'selectAll', label: 'Selecionar tudo' }] },
    { label: 'Visualizar', submenu: [{ role: 'reload', label: 'Recarregar' }, { role: 'toggleDevTools', label: 'Ferramentas do desenvolvedor' }, { type: 'separator' }, { role: 'resetZoom', label: 'Tamanho real' }, { role: 'zoomIn', label: 'Aumentar' }, { role: 'zoomOut', label: 'Diminuir' }, { type: 'separator' }, { role: 'togglefullscreen', label: 'Tela cheia' }] },
    { label: 'Janela', submenu: [{ role: 'minimize', label: 'Minimizar' }, { role: 'zoom', label: 'Zoom' }] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(() => {
  loadSettings();
  registerProtocol();
  registerIpc();
  buildMenu();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (host) try { host.kill(); } catch (e) {} if (linkJob) killJob(linkJob); if (!isMac) app.quit(); });
app.on('before-quit', () => { if (host) try { host.kill(); } catch (e) {} });
