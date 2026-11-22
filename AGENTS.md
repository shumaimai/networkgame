# ネットワーク屋さん

ネットワーク構築を学ぶ2Dゲーム。Vite + TypeScript(フレームワークなし)。Node.js v26(`C:\Program Files\nodejs`、シェルのPATHに無ければ `export PATH="/c/Program Files/nodejs:$PATH"`)。

## コマンド
- `npm run dev` 開発サーバー(http://127.0.0.1:5173)
- `npm run typecheck` / `npm test`(vitest: シミュレータ・生成器・進行)
- `node e2e/panel.mjs` 設定パネルの入力テスト(dev サーバー起動中)
- `node e2e/run.mjs` 画面の通しテスト(dev サーバー起動中に実行。Edge を playwright-core で操作)
- `node e2e/adv.mjs` Lv.17 以降の依頼を種類ごとに1件ずつ、机に置く・つなぐ・片付ける操作で組んで納品する。依頼の種類や検収テストを足したら必ず通す
- `node e2e/shot.mjs <title|hub|board|offer|t1|shop|ware|guide [項目id]|solved|trouble|adv [タグか題名の一部] [機器の種類]|adv0 ...>` 画面を `shots/` に撮る(adv は模範解答を置いた状態、adv0 は受注した直後)
- `npm run build` → `dist/` / `npm run app` デスクトップアプリで起動 / `npm run package` → `release/`(確認は `node e2e/app.mjs`。シェルに ELECTRON_RUN_AS_NODE があると起動しないので unset する)
- 変更したら typecheck、npm test、e2e(run.mjs・panel.mjs・adv.mjs)を通す

## 構成
- `src/core/` 画面に依存しない中身
  - `model.ts` 機器カタログと設定の型 / `ip.ts` IPv4計算
  - `sim.ts` シミュレータ(VLAN・トランク、DHCP・リレー、NAT、ポート転送、フィルター、DNS、プロキシ、ARP、回線の複数契約、広域イーサネット、クラウド、拠点間VPN、VRRP、リバースプロキシ、DKIM/DMARC、監視)
  - `checks.ts` 検収テスト(依頼ごとに生成。全部通れば納品できる)
  - `gen.ts` 依頼の自動生成(要件 → 正解の構成 → 検収テスト → シミュレータで検証)/ `faults.ts` トラブル対応用の不具合
  - `scen.ts` 拠点やクラウドをまたぐ依頼(Lv.19〜)。`Plan`(支店の数、拠点間のつなぎ方、冗長化、クラウドなど)から構成を組む `compose` と、依頼の種類の表 `TEMPLATES`。構成変更の依頼は、変更前と変更後の2つの `Plan` を同じ材料から組む
  - `genlib.ts` gen.ts と scen.ts の共通部品(業種と名前、難易度と報酬、トラブル対応への作り替え)
- `src/game/` `state.ts` 進行(レベル、相場、倉庫、受注、ヘルプ、納品)/ `tutorial.ts` 研修3件 / `guide.ts` ガイドの本文と図解
- `src/ui/` `app.ts`(1920×1080の固定ステージを拡大縮小)/ `hub.ts` 受注 / `shop.ts` 仕入れ / `ware.ts` 倉庫 / `guide.ts` ガイド / `bench.ts` 作業画面 / `desk.ts` 机(SVG)/ `panel.ts` 機器の設定 / `style.css`
- `public/img/` Geminiで作った素材。`python tools/gen_assets.py [名前]` で作り直せる(マゼンタ背景を抜く)

## 決まり
- 学習内容を足すときは、sim.ts・gen.ts(組み立てと検収テスト)・faults.ts・ガイド(guide.ts)・LEVELS(state.ts)をそろえて更新する
- 生成した依頼は必ず `evaluate(solution)` が全合格になること(tests/gen.test.ts が全レベルで確認)
- 検収テストから、プレイヤーが購入して置く機器をIDで指さない(置いたときにIDが変わる)。名前解決、IPアドレス、機器の種類で指す。お客様の機器(supplied)と据え付けの設備(fixed)はIDで指してよい
- すでに出ているレベルの依頼の中身を変えない。新しい内容の抽選には別の乱数(gen.ts の `r2`)を使い、新しい不具合は `faultCatalog2` に足す
- 新しい設定項目を足したら `defaultCfg` に入れる。古いセーブには `fillCfg` が補う。設定欄は `PanelCtx.level` で、そのレベルに届くまで隠す
- チュートリアルの案内は `[data-pal]` `[data-dev]` `[data-port]` `[data-diag]` `[data-act]` を目印にしている。属性名を変えたら tutorial.ts も直す
- シェル経由のコマンドは約8KBで切れる。大きなファイルはヒアドキュメントで書かない

## 用語と文体
- 画面の言葉: 受注・仕入れ・倉庫(別々の画面)、スロット(倉庫の単位)、ガイド、契約金、検収テスト、N週目(「第N週」とは書かない)
- ガイドの項目には、できるだけ `example`(具体例でたどる)を付ける。1つの場面を、ゲームで実際に使えるアドレスや名前(www.example.com → 93.184.216.34 など)で順に書く。たとえ話にはしない
- 受注と倉庫の画面は、画面の下まで使う(カードや欄を伸ばし、中身で埋める)。週が変わったあと最初に受注画面を開くと、週と値動きの知らせ(`.week-banner`)が数秒出る
- 文章は「何を、どうする」を具体的に書く。比喩、呼びかけ(ようこそ、あと一歩 など)、同じ内容の言い直しは入れない
- 抜き出して検査する: `python tools/extract_text.py src/game/guide.ts ... > shots/gametext.md` → `python .devin/skills/yomiyasu/scripts/yomiyasu_lint.py shots/gametext.md`(trailing_colon はコード片への誤検出)

## 日本語の文章
- ゲーム内の文章(依頼文、ヒント、ガイド、チュートリアル、画面の文言)を書いたり直したりしたら、仕上げに yomiyasu で推敲する(`.devin/skills/yomiyasu/`、v3.1.0)
- 検査: 文章を標準入力で渡す `python .devin/skills/yomiyasu/scripts/yomiyasu_lint.py -`
- SKILL.md 中の `${CLAUDE_SKILL_DIR}` は `.devin/skills/yomiyasu` と読み替える

## 素材
- 画像は Gemini API で作る。キーはユーザー環境変数 `gemini`(レジストリ HKCU\Environment から読む)。キーを表示・記録しない
- 効果音は `src/ui/audio.ts` でその場で合成している(素材ファイルなし)
