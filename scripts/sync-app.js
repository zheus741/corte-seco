/* Copy the shared editor (web app) into the desktop package. */
const fs = require('fs'), path = require('path');
const src = process.env.CS_APP_SRC || path.join(__dirname, '..', '..', 'app');
const dst = path.join(__dirname, '..', 'app');
if (path.resolve(src) === path.resolve(dst) || !fs.existsSync(src)) { console.log('app já está no lugar'); process.exit(0); }
fs.rmSync(dst, { recursive: true, force: true });
fs.cpSync(src, dst, { recursive: true, filter: (p) => !/\.map$/.test(p) });
console.log('app copiado de', src);
