"""Gemini で2D素材を作り、背景(マゼンタ)を抜いて public/img に置く。
使い方: python tools/gen_assets.py [名前 ...]   (名前を省くと、まだ無いものを全部作る)
APIキーはユーザー環境変数 gemini から読む。キーは表示しない。"""
import base64, io, json, os, sys, urllib.request, urllib.error, winreg
from PIL import Image

sys.stdout.reconfigure(encoding='utf-8')
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW, OUT = os.path.join(ROOT, 'assets', 'raw'), os.path.join(ROOT, 'public', 'img')
MODEL = 'gemini-3.1-flash-image'
with winreg.OpenKey(winreg.HKEY_CURRENT_USER, 'Environment') as k:
    KEY = winreg.QueryValueEx(k, 'gemini')[0]

ICON = ('Single game icon for a cozy network-building puzzle game. Flat 2D vector illustration, thick dark navy outline, '
        'soft cel shading with one simple highlight, rounded friendly shapes, limited palette: teal, indigo, slate blue, cream, with small warm orange accents. '
        'One object only, centered, filling about 80% of the frame, slight three-quarter front view. '
        'Solid pure magenta (#FF00FF) background, completely flat, no gradient, no shadow, no floor, no text, no letters, no logo, no border. Object: ')
PORTRAIT = ('Character portrait icon for a cozy puzzle game: head and shoulders, friendly expression, facing viewer. Flat 2D vector illustration, thick dark navy outline, '
            'soft cel shading, rounded shapes, limited palette: teal, indigo, slate blue, cream, warm orange accents. '
            'Solid pure magenta (#FF00FF) background, completely flat, no text, no border. Character: ')
ASSETS = {
    # 機器 (key=True は背景を抜く)
    'pc': (ICON + 'a desktop computer: a monitor on a stand with a dark teal screen, and a small keyboard in front.', '1:1', True),
    'printer': (ICON + 'an office printer with a sheet of paper coming out of the front tray.', '1:1', True),
    'phone': (ICON + 'a desk IP telephone with a handset and a small screen.', '1:1', True),
    'camera': (ICON + 'a dome security camera with a short wall mount.', '1:1', True),
    'pos': (ICON + 'a point-of-sale cash register with a touch screen and a cash drawer.', '1:1', True),
    'server': (ICON + 'a tower server computer with three drive bays and small indicator lights.', '1:1', True),
    'nas': (ICON + 'a compact two-bay NAS storage box with two hard-drive slots on the front.', '1:1', True),
    'l2': (ICON + 'a small flat network switch box seen from the top-front, plain front panel with a row of tiny indicator lights only, no cables.', '1:1', True),
    'l2m': (ICON + 'a flat rack-style managed network switch box seen from the top-front, plain front panel with tiny indicator lights and one small console port, with an orange stripe, no cables.', '1:1', True),
    'l3': (ICON + 'a thick rack-style core network switch box seen from the top-front, two stacked units with tiny indicator lights and ventilation slots, indigo colored, no cables.', '1:1', True),
    'router': (ICON + 'a small home-office router box with two short antennas and a row of tiny indicator lights, no cables.', '1:1', True),
    'fw': (ICON + 'a network firewall appliance box with a small shield emblem made of bricks on its front, orange accent, no cables.', '1:1', True),
    'ap': (ICON + 'a round ceiling wireless access point disc with a small light ring and three curved signal waves above it.', '1:1', True),
    'home': (ICON + 'an open laptop computer with a small simple house symbol shown on its screen.', '1:1', True),
    'internet': (ICON + 'a fluffy white-blue cloud with a small globe grid pattern inside, representing the internet.', '1:1', True),
    # 依頼主
    'p_office': (PORTRAIT + 'an office worker in a shirt and tie holding a folder.', '1:1', True),
    'p_design': (PORTRAIT + 'an architect with round glasses and a pencil behind the ear.', '1:1', True),
    'p_shop': (PORTRAIT + 'a shop keeper wearing an apron.', '1:1', True),
    'p_clinic': (PORTRAIT + 'a doctor in a white coat with a stethoscope.', '1:1', True),
    'p_school': (PORTRAIT + 'a cram-school teacher holding a textbook.', '1:1', True),
    'p_hotel': (PORTRAIT + 'a hotel manager in a neat uniform with a small name tag (blank).', '1:1', True),
    'p_cafe': (PORTRAIT + 'a cafe owner with a beret holding a coffee cup.', '1:1', True),
    'p_factory': (PORTRAIT + 'a factory manager wearing a safety helmet and work jacket.', '1:1', True),
    'p_guide': (PORTRAIT + 'a cheerful senior network engineer mentor wearing a teal work jacket and a headset, giving a thumbs up.', '1:1', True),
    # 背景
    'bg_title': ('Wide background illustration for the title screen of a cozy network-building puzzle game. A tidy workshop desk at night seen from the front: '
                 'network switches, a router, coiled LAN cables, a small server and a desk lamp, with a large window showing a calm city skyline. '
                 'Flat 2D vector illustration, thick dark navy outlines, soft cel shading, limited palette of deep navy, teal, indigo and warm orange lamp light. '
                 'Leave the upper-left third calm and dark for a title. No text, no letters, no logos.', '16:9', False),
    'bg_office': ('Wide background illustration of a small cozy network-service office interior seen from the front, at dusk: a cork notice board area on the wall (empty), '
                  'shelves with boxed network equipment, a plant, a window. Deep navy and teal tones, low contrast, slightly blurred and dark so that user-interface panels can be placed on top. '
                  'Flat 2D vector illustration, soft cel shading. No text, no letters, no logos, no people.', '16:9', False),
}

def call(prompt, aspect):
    body = {'contents': [{'parts': [{'text': prompt}]}], 'generationConfig': {'responseModalities': ['IMAGE'], 'imageConfig': {'aspectRatio': aspect}}}
    req = urllib.request.Request(f'https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent',
                                 data=json.dumps(body).encode(), headers={'Content-Type': 'application/json', 'x-goog-api-key': KEY})
    try:
        r = json.load(urllib.request.urlopen(req, timeout=240))
    except urllib.error.HTTPError as e:
        raise RuntimeError(e.read().decode('utf-8', 'replace')[:300])
    for c in r.get('candidates', []):
        for p in c.get('content', {}).get('parts', []):
            if 'inlineData' in p:
                return base64.b64decode(p['inlineData']['data'])
    raise RuntimeError('no image: ' + json.dumps(r)[:300])

def key_out(img, size):
    """マゼンタ背景を透明にし、縁の色かぶりを抑え、余白を切って正方形に収める"""
    img = img.convert('RGBA')
    px = img.load()
    w, h = img.size
    for y in range(h):
        for x in range(w):
            r, g, b, _ = px[x, y]
            m = min(r, b) - g                      # マゼンタらしさ
            if m > 120: px[x, y] = (0, 0, 0, 0)
            elif m > 40:
                a = int(255 * (120 - m) / 80)
                px[x, y] = (min(r, g + 40), g, min(b, g + 40), a)
    box = img.getbbox()
    if box: img = img.crop(box)
    side = max(img.size)
    canvas = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    canvas.paste(img, ((side - img.width) // 2, (side - img.height) // 2))
    return canvas.resize((size, size), Image.LANCZOS)

def main():
    os.makedirs(RAW, exist_ok=True); os.makedirs(OUT, exist_ok=True)
    names = sys.argv[1:] or [n for n in ASSETS if not os.path.exists(os.path.join(OUT, n + ('.png' if ASSETS[n][2] else '.jpg')))]
    for n in names:
        prompt, aspect, keyed = ASSETS[n]
        raw = os.path.join(RAW, n + '.bin')
        try:
            if n in sys.argv[1:] or not os.path.exists(raw):
                io.open(raw, 'wb').write(call(prompt, aspect))
            img = Image.open(raw)
            if keyed: key_out(img, 256).save(os.path.join(OUT, n + '.png'), optimize=True)
            else: img.convert('RGB').resize((1920, 1080), Image.LANCZOS).save(os.path.join(OUT, n + '.jpg'), quality=86)
            print('ok', n, flush=True)
        except Exception as e:
            print('NG', n, str(e)[:200], flush=True)

main()
