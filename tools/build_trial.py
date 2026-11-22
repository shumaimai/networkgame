# Webで公開するお試し版(Lv.5 まで)を、1つのHTMLファイルにまとめる: npm run trial
# 出力: trial/index.html (画像・フォント・プログラムを全部埋め込むので、このファイル1つを置けば動く)
#
# 手順:
#   1. VITE_TRIAL=1 を付けて vite build する(src/game/edition.ts がお試し版の設定に切り替わる)
#   2. 画像を小さくして(WebP)、ページに埋め込む
#   3. フォントは、ゲームの中で使う文字を含むファイルだけを埋め込む(日本語のフォントは約120個に分かれている)
#   4. CSS とプログラムを HTML の中に入れる
import base64, io, os, re, subprocess, sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(ROOT, 'dist-trial')
DEST = os.path.join(ROOT, 'trial', 'index.html')
sys.stdout.reconfigure(encoding='utf-8')


def data_uri(mime: str, raw: bytes) -> str:
    return f'data:{mime};base64,' + base64.b64encode(raw).decode('ascii')


def webp(path: str, quality: int, max_w: int | None = None) -> bytes:
    im = Image.open(path)
    if max_w and im.width > max_w:
        im = im.resize((max_w, round(im.height * max_w / im.width)), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, 'WEBP', quality=quality, method=6)
    return buf.getvalue()


def in_ranges(ranges: str, chars: set[int]) -> bool:
    """@font-face の unicode-range に、使う文字が1つでも入っているか"""
    for part in ranges.split(','):
        m = re.match(r'U\+([0-9A-Fa-f?]+)(?:-([0-9A-Fa-f]+))?', part.strip())
        if not m:
            continue
        lo, hi = m.group(1), m.group(2)
        if '?' in lo:
            a, b = int(lo.replace('?', '0'), 16), int(lo.replace('?', 'F'), 16)
        else:
            a = int(lo, 16)
            b = int(hi, 16) if hi else a
        if any(a <= c <= b for c in chars):
            return True
    return False


def main() -> None:
    env = dict(os.environ, VITE_TRIAL='1')
    subprocess.run('npx vite build --outDir dist-trial --emptyOutDir', cwd=ROOT, env=env, shell=True, check=True, stdout=subprocess.DEVNULL)
    assets = os.path.join(OUT_DIR, 'assets')
    html = open(os.path.join(OUT_DIR, 'index.html'), encoding='utf-8').read()
    js_name = re.search(r'src="\./assets/([^"]+\.js)"', html).group(1)
    css_name = re.search(r'href="\./assets/([^"]+\.css)"', html).group(1)
    js = open(os.path.join(assets, js_name), encoding='utf-8').read()
    css = open(os.path.join(assets, css_name), encoding='utf-8').read()
    assert 'import(' not in js.replace('import.meta', ''), 'プログラムが複数のファイルに分かれている(1つにまとめられない)'

    # ---- フォント: 使う文字を含むものだけ残す ----
    chars = {ord(c) for c in js + css + html}
    kept = dropped = font_bytes = 0

    def face(m: re.Match) -> str:
        nonlocal kept, dropped, font_bytes
        block = m.group(0)
        # 太さ400の日本語フォントは入れない。画面の文字は500・700・900で、400を求められたときはブラウザが500を使う
        if 'Zen Maru Gothic' in block and 'font-weight:400' in block:
            dropped += 1
            return ''
        rng = re.search(r'unicode-range:([^;}]+)', block)
        if rng and not in_ranges(rng.group(1), chars):
            dropped += 1
            return ''
        u = re.search(r'url\(([^)]+\.woff2)\)', block)
        if not u:
            # 小さいフォントは、vite がすでに埋め込んでいる
            kept += 1
            return block
        raw = open(os.path.join(assets, os.path.basename(u.group(1).strip('"\''))), 'rb').read()
        kept += 1
        font_bytes += len(raw)
        # woff2 だけを残す(いまのブラウザはどれも読める)
        return re.sub(r'src:[^;}]+', lambda _: f'src:url({data_uri("font/woff2", raw)}) format("woff2")', block, count=1)

    css = re.sub(r'@font-face\{[^}]*\}', face, css)

    # ---- 画像 ----
    img_dir = os.path.join(ROOT, 'public', 'img')
    img_bytes = 0

    def bg(m: re.Match) -> str:
        nonlocal img_bytes
        raw = webp(os.path.join(img_dir, os.path.basename(m.group(1))), 62, 1600)
        img_bytes += len(raw)
        return f'url({data_uri("image/webp", raw)})'

    css = re.sub(r'url\(["\']?[^)"\']*?/img/([\w.-]+\.webp)["\']?\)', bg, css)
    assert '/img/' not in css, 'CSS に、埋め込めていない画像が残っている'
    sprites = {}
    for name in sorted(os.listdir(img_dir)):
        if name.endswith('.webp') and not name.startswith('bg_'):
            raw = webp(os.path.join(img_dir, name), 80)
            img_bytes += len(raw)
            sprites[name[:-5]] = data_uri('image/webp', raw)
    icon = open(os.path.join(ROOT, 'public', 'favicon.svg'), 'rb').read()

    # ---- 1つのHTMLにまとめる ----
    import json
    page = f'''<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ネットワーク屋さん お試し版</title>
  <meta name="description" content="社内ネットワークの構築と修理を請け負う仕事のゲーム。お試し版では Lv.5 まで遊べます。">
  <link rel="icon" href="{data_uri('image/svg+xml', icon)}">
  <style>{css}</style>
</head>
<body>
  <div id="stage"><div id="screen"></div><div id="overlay"></div><div id="toasts"></div></div>
  <noscript>このゲームを遊ぶには、ブラウザの JavaScript を有効にしてください。</noscript>
  <script>window.__IMG = {json.dumps(sprites)};</script>
  <script type="module">{js.replace('</script', '<\\/script')}</script>
</body>
</html>
'''
    os.makedirs(os.path.dirname(DEST), exist_ok=True)
    with open(DEST, 'w', encoding='utf-8', newline='\n') as f:
        f.write(page)
    kb = lambda n: f'{n / 1024:,.0f} KB'
    print(f'trial/index.html を書きました: {kb(os.path.getsize(DEST))}')
    print(f'  プログラム {kb(len(js.encode()))} / フォント {kept}個 {kb(font_bytes)}(使わない {dropped}個は外した) / 画像 {len(sprites) + 3}枚 {kb(img_bytes)}')


if __name__ == '__main__':
    main()
