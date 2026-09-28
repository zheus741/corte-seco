"""Build the standalone, installable web version of Corte Seco into site/ (served by Vercel with Root Directory = site).
Run from the repo root after changing app/:  python3 web/build.py"""
import hashlib, json, os, shutil, re
from PIL import Image
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); HERE = os.path.join(ROOT, 'web')
APP = os.path.join(ROOT, 'app'); OUT = os.path.join(ROOT, 'site')
shutil.rmtree(OUT, ignore_errors=True); os.makedirs(OUT)
# assets, same layout as the app
for d in ('fonts', 'lib', 'ort', 'models'):
    shutil.copytree(os.path.join(APP, d), os.path.join(OUT, d))
for f in ('asr-core.js', 'asr-worker.js', 'face-worker.js'):
    shutil.copy(os.path.join(APP, f), OUT)
# page: the app markup inside a real document
src = open(os.path.join(APP, 'index.html'), encoding='utf-8').read()
head, body = src.split('</style>', 1)
meta = '''<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="Corte Seco: solte o vídeo e saem os cortes. Transcreve, tira as pausas, acha os melhores trechos e põe legenda viral com a sua marca, tudo no seu computador.">
<meta name="theme-color" content="#111113">
<meta name="color-scheme" content="dark">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Corte Seco">
<meta property="og:title" content="Corte Seco">
<meta property="og:description" content="Solte o vídeo. Saem os cortes. Edição automática para Reels, no seu computador.">
<meta property="og:image" content="icons/og.png">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icons/icon-180.png">
'''
page = meta + head + '</style>\n</head>\n<body>\n' + body.strip() + '\n</body>\n</html>\n'
open(os.path.join(OUT, 'index.html'), 'w', encoding='utf-8').write(page)
# icons
os.makedirs(os.path.join(OUT, 'icons'))
src_icon = Image.open(os.path.join(ROOT, 'build', 'icon.png')).convert('RGBA')
for sz in (192, 512): src_icon.resize((sz, sz), Image.LANCZOS).save(os.path.join(OUT, 'icons', f'icon-{sz}.png'))
tile = src_icon.crop((100, 100, 924, 924)); full = Image.new('RGBA', tile.size, (17, 17, 19, 255)); full.alpha_composite(tile)
for sz in (512, 192): full.resize((sz, sz), Image.LANCZOS).save(os.path.join(OUT, 'icons', f'maskable-{sz}.png'))
full.convert('RGB').resize((180, 180), Image.LANCZOS).save(os.path.join(OUT, 'icons', 'icon-180.png'))
og = Image.new('RGB', (1200, 630), (11, 11, 12)); m = full.convert('RGB').resize((360, 360), Image.LANCZOS); og.paste(m, (420, 135)); og.save(os.path.join(OUT, 'icons', 'og.png'))
# manifest
manifest = {
  "name": "Corte Seco", "short_name": "Corte Seco", "id": "/", "start_url": "/", "scope": "/",
  "description": "Solte o vídeo, saem os cortes: edição automática para Reels, no seu computador.",
  "lang": "pt-BR", "display": "standalone", 
  "background_color": "#0B0B0C", "theme_color": "#111113", "categories": ["photo", "productivity", "utilities"],
  "icons": [
    {"src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
    {"src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
    {"src": "icons/maskable-192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable"},
    {"src": "icons/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"}],
  "file_handlers": [{"action": "/", "accept": {"video/mp4": [".mp4", ".m4v"], "video/quicktime": [".mov"], "video/webm": [".webm"]}, "launch_type": "single-client"}],
  "launch_handler": {"client_mode": "focus-existing"}
}
open(os.path.join(OUT, 'manifest.webmanifest'), 'w').write(json.dumps(manifest, ensure_ascii=False, indent=1))
# service worker: app shell precached; models and the rest cached on first use
files = []
for root, _, fs in os.walk(OUT):
    for f in fs: files.append(os.path.relpath(os.path.join(root, f), OUT))
h = hashlib.sha1()
for f in sorted(files): h.update(f.encode()); h.update(open(os.path.join(OUT, f), 'rb').read())
ver = h.hexdigest()[:10]
shell = ['./', 'index.html', 'manifest.webmanifest', 'asr-core.js', 'asr-worker.js', 'face-worker.js', 'lib/mediabunny.js', 'lib/mediabunny-aac.js', 'icons/icon-192.png'] + sorted('fonts/' + f for f in os.listdir(os.path.join(OUT, 'fonts')) if f.startswith('ui-'))
sw = open(os.path.join(HERE, 'sw.template.js')).read().replace('__VERSION__', ver).replace('__SHELL__', json.dumps(shell))
open(os.path.join(OUT, 'sw.js'), 'w').write(sw)
shutil.copy(os.path.join(HERE, 'vercel.json'), OUT)
total = sum(os.path.getsize(os.path.join(OUT, f)) for f in files)
print('build', ver, len(files) + 2, 'files', round(total / 1e6, 1), 'MB')
