"""ゲーム内の日本語の文章を抜き出す(yomiyasu の検査にかけるため)。
使い方: python tools/extract_text.py src/game/dict.ts ... > shots/gametext.md"""
import io, re, sys
sys.stdout.reconfigure(encoding='utf-8')
BS = chr(92)
SQ = re.compile("'((?:[^'" + BS * 2 + "\n]|" + BS * 2 + ".){25,})'")
BQ = re.compile("`((?:[^`" + BS * 2 + "]|" + BS * 2 + ".){25,})`")
JP = re.compile('[ぁ-んァ-ヶ一-龥]{4,}')
for f in sys.argv[1:]:
    s = io.open(f, encoding='utf-8').read()
    print('# ' + f + '\n')
    for rx in (SQ, BQ):
        for m in rx.finditer(s):
            t = m.group(1)
            if JP.search(t) and '<div' not in t and 'class=' not in t:
                print(re.sub(r'\$\{[^}]*\}', 'X', t).replace(BS + 'n', ' ') + '\n')
