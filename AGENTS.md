# ネットワーク屋さん(プロトタイプ)

現状はビルド不要の静的サイト(素のHTML/CSS/JS、依存ライブラリなし)。Node.js v26 は導入済み(`C:\Program Files\nodejs`)。TypeScript + Vite への移行を予定。

## 起動
- `index.html` をブラウザで直接開く。または `python -m http.server 8765 --bind 127.0.0.1` で配信。

## 構成
- 画面: 左=依頼文と納品条件 / 中央=机(SVG)とログ / 右=機材パレット(上)と選択中の機器の設定(下)
- 依頼は2種類。構築(空の机から組む)とトラブル対応(既設ネットワークの不具合を直す)。依頼ボードから選び、納品件数(need)で解放される
- サーバー機にDNSサービス(レコード・フォワーダー)とプロキシサービス(待受ポート・利用許可)を立てる。1台で兼用可。電源の概念はない
- お客様の既設ケーブルは無料(free)。外すと手元に残り(spare)、つなぎ直しに使える
- `js/ip.js` IPv4計算 / `js/model.js` 機器カタログと初期状態 / `js/sim.js` 通信シミュレータ(DOM非依存)
- `js/levels.js` 依頼定義(supplied/cables/shop・納品条件・契約金・par) / `js/game.js` 画面と操作
- `tests/solutions.js` 各依頼の模範解答(テストが使用。依頼を変えたらここも更新。par は模範解答の機材費と一致させる)
- 診断ツールは `Sim.build(..., {trace:true})` の記録(通ったケーブル列)を使ってパケットをアニメーションする

## テスト(Edgeのヘッドレスで実行)
先に上記の http.server を起動しておく(`tests/ui.html` は file:// では動かない)。

    EDGE="/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
    for t in sim ui; do MSYS_NO_PATHCONV=1 "$EDGE" --headless=new --disable-gpu --no-first-run \
      --user-data-dir="$(cygpath -w "$(mktemp -d)")" --window-size=1500,1000 --virtual-time-budget=40000 \
      --dump-dom "http://127.0.0.1:8765/tests/$t.html" 2>/dev/null | grep -E "^FAIL|^RESULT"; done

どちらも `RESULT: PASS` になればOK。

## 注意
- シェル経由のコマンドは約8KBで切れる。大きなファイルはヒアドキュメントで書かない。
- SVGの `text-anchor` はCSS側の指定が属性より優先される。位置揃えはクラスで切り替える。
- ヘッドレスの仮想時間では requestAnimationFrame がほぼ発火しない。アニメーションはタイマーとの早い方で進めている(`frame()`)。

## 日本語の文章
- ゲーム内の文章(依頼文、ヒント、辞書、チュートリアル、画面の文言)を書いたり直したりしたら、仕上げに yomiyasu で推敲する(`.devin/skills/yomiyasu/`、v3.1.0)。
- 検査スクリプト: `python .devin/skills/yomiyasu/scripts/yomiyasu_lint.py <ファイル.md>`
- SKILL.md 中の `${CLAUDE_SKILL_DIR}` は `.devin/skills/yomiyasu` と読み替える。Devin の形式に合わないため frontmatter の `allowed-tools` 行だけ削ってある。

## 素材
- 画像は Gemini API で作る。キーはユーザー環境変数 `gemini`(このシェルのプロセス環境には無いので、レジストリ HKCU\Environment から読む)。キーを表示・記録しない。
- `assets/trial/` は画風の試作。
