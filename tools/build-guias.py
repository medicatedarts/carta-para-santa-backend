# Genera las guías transparentes (2550x3300 = 8.5x11" a 300 ppp) para diseñar fondos.
# Se colocan como capa superior en Photoshop/Illustrator/Canva/Procreate y se ocultan al exportar.
import json, math, os
from PIL import Image, ImageDraw, ImageFont
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
L = json.load(open(os.path.join(ROOT, 'papeles', 'layout.json')))
OUT = os.path.join(ROOT, 'docs', 'plantilla-fondos')
DPI = 300; W, H = 2550, 3300
def F(sz, b=False):
    return ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans%s.ttf' % ('-Bold' if b else ''), sz)
def px(i): return int(round(i * DPI))
def dline(d, a, b, c, e, col, w, dash):
    n = math.hypot(c - a, e - b)
    if n == 0: return
    k = 0
    while k * dash < n:
        t0 = k * dash / n; t1 = min(1, (k * dash + dash / 2) / n)
        d.line([(a + (c - a) * t0, b + (e - b) * t0), (a + (c - a) * t1, b + (e - b) * t1)], fill=col, width=w)
        k += 1
def drect(d, x0, y0, x1, y1, col, w=6, dash=60):
    for s in [(x0, y0, x1, y0), (x1, y0, x1, y1), (x1, y1, x0, y1), (x0, y1, x0, y0)]:
        dline(d, *s, col, w, dash)
RED, BLUE, ORANGE, GREEN, PURPLE = (220,40,40,255), (40,90,220,255), (200,110,0,255), (10,110,50,255), (100,40,150,255)
def base(title):
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.rectangle([0, 0, W - 1, H - 1], outline=(0, 0, 0, 255), width=4)
    m = px(0.125); drect(d, m, m, W - m, H - m, RED)
    label(im, (px(0.6), H - px(0.42)), 'Línea roja = margen de seguridad 1/8" (0.125"). Nada importante fuera de ella; el color de fondo sí puede llegar al borde.', RED, F(28))
    for fy in (11 / 3, 22 / 3):
        y = px(fy); dline(d, 0, y, W, y, BLUE, 4, 40)
        d.text((W - px(2.9), y + 10), 'Doblez del sobre (%.2f")' % fy, fill=BLUE, font=F(32))
    # Zona de marcas de control que Lob imprime en el margen izquierdo inferior
    d.rectangle([0, px(8.7), px(0.5), px(10.85)], fill=(255, 170, 0, 90), outline=ORANGE, width=4)
    label(im, (px(0.58), px(10.1)), '<- Lob imprime aquí sus\n   marcas de control (puede\n   pasar en cualquier página).\n   No pongas nada importante.', ORANGE, F(28), 6)
    return im, d, title
def label(im, xy, text, col, font, spacing=8):
    d = ImageDraw.Draw(im)
    x0, y0, x1, y1 = d.multiline_textbbox(xy, text, font=font, spacing=spacing)
    d.rectangle([x0 - 12, y0 - 8, x1 + 12, y1 + 8], fill=(255, 255, 255, 215))
    d.multiline_text(xy, text, fill=col, font=font, spacing=spacing)
def box(d, t, col, fill):
    d.rectangle([px(t['x']), px(t['y']), px(t['x'] + t['w']), px(t['y'] + t['h'])], fill=fill, outline=col, width=6)

# Página 1 — Santa
S = L['santa']; im, d, title = base('Página 1 · Respuesta de Santa  (santa.jpg)')
z = S['addressZone']
box(d, z, (60, 60, 60, 255), (120, 120, 120, 120))
d.text((px(0.35), px(0.75)), 'ZONA DE DIRECCIÓN (Lob)\n0" a 4.25" ancho · 0" a 2.95" alto\n\nDéjala lisa y clara. Lob pone un\nrecuadro blanco con remitente,\ndestinatario y código de barras.\nEs lo que se ve por la ventana\ndel sobre.', fill=(25, 25, 25, 255), font=F(38, True), spacing=10)
t = S['textBox']; box(d, t, GREEN, (40, 170, 90, 55))
d.text((px(t['x']) + 30, px(t['y']) + 30), 'CAJA DE TEXTO DE SANTA\nx %s"  y %s"  ancho %s"  alto %s"\n\nSaludo, 4 párrafos, despedida, firma y P.D.\nFondo liso o con textura muy suave (papel),\nsin dibujos debajo del texto.' % (t['x'], t['y'], t['w'], t['h']), fill=GREEN, font=F(40, True), spacing=12)
dt = S['date']; d.rectangle([px(dt['x']), px(dt['y']), px(dt['x'] + dt['w']), px(dt['y'] + 0.3)], outline=GREEN, width=5)
d.text((px(dt['x']), px(dt['y'] + 0.36)), 'Fecha ("Diciembre, 2026")', fill=GREEN, font=F(30))
label(im, (px(4.45), px(2.68)), 'LIBRE para tu diseño (membrete, escudo, adornos)', PURPLE, F(30, True))
label(im, (px(4.45), px(0.2)), title, (0, 0, 0, 255), F(32, True))
im.save(os.path.join(OUT, 'guia-pagina1-santa.png'))

# Página 2 — una guía por papel, con su caja de texto actual
def page2(name, t, note):
    im, d, title = base('Página 2 · Carta del niño  (%s)' % name)
    label(im, (px(0.3), px(0.2)), title, (0, 0, 0, 255), F(40, True))
    box(d, t, GREEN, (40, 170, 90, 55))
    d.text((px(t['x']) + 30, px(t['y']) + 30), 'CAJA DE TEXTO DE LA CARTA\nx %s"  y %s"  ancho %s"  alto %s"\n\n%s' % (t['x'], t['y'], t['w'], t['h'], note), fill=GREEN, font=F(36, True), spacing=12)
    label(im, (px(0.75), px(0.75)), 'LIBRE para tu diseño todo lo que queda fuera de la caja verde\n(respetando el margen rojo y la zona naranja). La página entera\nes la carta: no hay zona de dirección en la página 2.', PURPLE, F(34, True))
    return im
note = ('El sistema escribe aquí el saludo, el mensaje,\nla lista de deseos y la firma, dibuja las líneas\nde cuaderno y ajusta el tamaño de la letra.\n\nDentro de la caja: color liso o textura suave,\nSIN líneas dibujadas (las pone el código).\nPuedes moverla o cambiar su tamaño: dame las\nnuevas medidas en pulgadas.  Mínimo: 5.5" x 6".')
page2('papel-nuevo.jpg', {'x': 1.0, 'y': 2.0, 'w': 6.5, 'h': 7.0}, note).save(os.path.join(OUT, 'guia-pagina2-carta.png'))
for k, v in L['designs'].items():
    page2('papel-%s.jpg' % k, v['textBox'], note).save(os.path.join(OUT, 'guia-pagina2-%s.png' % k))
print('ok')
