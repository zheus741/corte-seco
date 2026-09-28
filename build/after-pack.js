/* Keep only the native transcription engine for the platform being packaged. */
const fs = require('fs');
const path = require('path');
const ARCH = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' };
exports.default = async function afterPack(ctx) {
  const plat = ctx.electronPlatformName;
  const arch = ARCH[ctx.arch] || 'x64';
  const res = plat === 'darwin'
    ? path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : path.join(ctx.appOutDir, 'resources');
  const bin = path.join(res, 'app.asar.unpacked', 'node_modules', 'onnxruntime-node', 'bin', 'napi-v6');
  if (!fs.existsSync(bin)) { console.log('  • after-pack: no native engine folder'); return; }
  for (const p of fs.readdirSync(bin)) {
    const pdir = path.join(bin, p);
    if (p !== plat) { fs.rmSync(pdir, { recursive: true, force: true }); continue; }
    for (const a of fs.readdirSync(pdir)) if (a !== arch) fs.rmSync(path.join(pdir, a), { recursive: true, force: true });
  }
  console.log(`  • after-pack: native engine kept for ${plat}/${arch}: ${fs.existsSync(path.join(bin, plat, arch))}`);
};
