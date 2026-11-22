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
- `node e2e/extra.mjs` ガイドへの近道、故障テスト、コピーと設定を写すボタン、常連の依頼、仕入れの画面
- `node e2e/play.mjs` AIに遊ばせて見つかった点(研修の案内の位置、習う前の設定欄、ポートの重なり、設定パネルの状態表示、納品結果の収まり)
- 変更したら typecheck、npm test、e2e(run.mjs・panel.mjs・adv.mjs・extra.mjs・play.mjs)を通す
- `node tools/maxsave.mjs [app]` 最高レベルのセーブを `saves/max-level.json` に作る(app を付けるとデスクトップアプリにも入れる)。設定の「セーブデータを読み込む」で読める。`node e2e/app.mjs` は一時フォルダのセーブで起動するので、遊んでいるセーブ(%APPDATA%/NetworkShop)には触らない

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
- 画面(`mountXxx`)は、渡された root にクリックなどの処理を付けてよい。`App.show` が画面ごとに root を作り直すので、前の画面の処理は残らない(root を使い回すと、同じ操作が何回も実行される)
- 設定パネルの見出し(`<h3>`)を足したら、panel.ts の `HELP` に対応するガイドの項目を足す。依頼のタグを足したら、guide.ts の `TAG_GUIDE` に足す
- 機器の `off`(故障テストで止めてある)は、sim.ts の `build` が机にないものとして扱う。止めたままでは納品できない
- 研修のヒント(`Step.hints`)は段階にする。先に「次に何を見比べるか」を書き、答えは最後に置く。時間では出さず、押したときと、操作に応じた一言(`Step.note`)で出す
- 設定を写すボタンは、IPアドレスを写さない(同じ番号の機器を増やさないため)。写す元は、同じL2の範囲(同じVLAN)にある同じ種類の端末だけ。Lv.3 から出す。tests/copy.test.ts が、全レベルの模範解答で、写した結果が検収テストに通ることを確かめる
- 検収テストの並び順は変えない(直すたびに位置が動くと追いにくい)。故障テスト中は、冗長化の項目を「保留」にする
- プレイの記録(`Save.log`)は、納品と取り下げのたびに1行増える。実績の画面からCSVで書き出せる
- お金の表示で在庫品を扱うときは「今週の新品との差」と書き、節約とは書かない
- 納品後の振り返り(`game/review.ts`): 新しい不具合を足したら、`FIND` に見つけ方を足す(tests/game.test.ts が、決まり文句の見つけ方になっていないかを確かめる)
- 常連の依頼(`game/regular.ts`)は、納品したときの机の上(`Save.keep`)を最初の状態にする。いまは研修1の田中税理士事務所だけ
- 設定欄は、その内容を習うレベルまで隠す(panel.ts の `GATE`)。すでに使われている設定は、レベルに関係なく出す。tests/play.test.ts が、模範解答に要る欄がそのレベルで出ていることを確かめる
- 設定パネルの中の「いまの状態」の表示(接続中・未接続など)には `data-live` を付ける。入力のたびに、その部分だけが更新される。条件で出たり消えたりする表示は、空のときも要素を残す
- 不具合(faults.ts)は、目的のレコードや項目を値や名前で選ぶ(「最初のTXTレコード」のような選び方をしない)。同じ場所を触る不具合と、机の上を何も変えない不具合は、genlib.ts の `makeTrouble` が外す
- 研修の案内(`#coach`)は机の下に置く。机の上に重ねない
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
