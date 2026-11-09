# tools/render-fondos.py
# Convierte tools/fondos-html/*.html en papeles/fondos/*.jpg de 2550×3300 px (8.5×11" a 300 ppp).
# Requiere Python con Playwright y Chrome:  python3 tools/render-fondos.py
import glob, os
from playwright.sync_api import sync_playwright
here = os.path.dirname(os.path.abspath(__file__))
out = os.path.join(here, '..', 'papeles', 'fondos')
os.makedirs(out, exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get('CHROME', '/usr/bin/google-chrome'))
    pg = b.new_page(viewport={'width': 816, 'height': 1056}, device_scale_factor=3.125)
    for f in sorted(glob.glob(os.path.join(here, 'fondos-html', '*.html'))):
        name = os.path.splitext(os.path.basename(f))[0]
        pg.goto('file://' + f); pg.wait_for_timeout(500)
        pg.screenshot(path=os.path.join(out, name + '.jpg'), type='jpeg', quality=88, clip={'x': 0, 'y': 0, 'width': 816, 'height': 1056})
        print('ok', name)
    b.close()
