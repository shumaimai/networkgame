# ネットワーク屋さん

ネットワーク構築を学ぶ2Dゲーム。Vite + TypeScript(フレームワークなし)。Node.js v26(`C:\Program Files\nodejs`、シェルのPATHに無ければ `export PATH="/c/Program Files/nodejs:$PATH"`)。

## コマンド
- `npm run dev` 開発サーバー(http://127.0.0.1:5173)
- `npm run typecheck` / `npm test`(vitest: シミュレータ・生成器・進行)
- `node e2e/panel.mjs` 設定パネルの入力テスト(dev サーバー起動中)
- `node e2e/run.mjs` 画面の通しテスト(dev サーバー起動中に実行。Edge を playwright-core で操作)
- `node e2e/shot.mjs <title|hub|board|offer|t1|shop|ware|guide [項目id]|solved|trouble|adv [タグ] [機器の種類]>` 画面を `shots/` に撮る
- `npm run build` → `dist/` / `npm run app` デスクトップアプリで起動 / `npm run package` → `release/`(確認は `node e2e/app.mjs`。シェルに ELECTRON_RUN_AS_NODE があると起動しないので unset する)
- 変更したら typecheck、npm test、e2e の3つを通す

## 構成
- `src/core/` 画面に依存しない中身
  - `model.ts` 機器カタログと設定の型 / `ip.ts` IPv4計算
  - `sim.ts` シミュレータ(VLAN・トランク、DHCP・リレー、NAT、ポート転送、フィルター、DNS、プロキシ、ARP)
  - `checks.ts` 検収テスト(依頼ごとに生成。全部通れば納品できる)
  - `gen.ts` 依頼の自動生成(要件 → 正解の構成 → 検収テスト → シミュレータで検証)/ `faults.ts` トラブル対応用の不具合
- `src/game/` `state.ts` 進行(レベル、相場、倉庫、受注、ヘルプ、納品)/ `tutorial.ts` 研修3件 / `guide.ts` ガイドの本文と図解
- `src/ui/` `app.ts`(1920×1080の固定ステージを拡大縮小)/ `hub.ts` 受注 / `shop.ts` 仕入れ / `ware.ts` 倉庫 / `guide.ts` ガイド / `bench.ts` 作業画面 / `desk.ts` 机(SVG)/ `panel.ts` 機器の設定 / `style.css`
- `public/img/` Geminiで作った素材。`python tools/gen_assets.py [名前]` で作り直せる(マゼンタ背景を抜く)

## 決まり
- 学習内容を足すときは、sim.ts・gen.ts(組み立てと検収テスト)・faults.ts・ガイド(guide.ts)・LEVELS(state.ts)をそろえて更新する
- 生成した依頼は必ず `evaluate(solution)` が全合格になること(tests/gen.test.ts が全レベルで確認)
- チュートリアルの案内は `[data-pal]` `[data-dev]` `[data-port]` `[data-diag]` `[data-act]` を目印にしている。属性名を変えたら tutorial.ts も直す
- シェル経由のコマンドは約8KBで切れる。大きなファイルはヒアドキュメントで書かない

## 用語と文体
- 画面の言葉: 受注・仕入れ・倉庫(別々の画面)、スロット(倉庫の単位)、ガイド、契約金、検収テスト
- 文章は「何を、どうする」を具体的に書く。比喩、呼びかけ(ようこそ、あと一歩 など)、同じ内容の言い直しは入れない
- 抜き出して検査する: `python tools/extract_text.py src/game/guide.ts ... > shots/gametext.md` → `python .devin/skills/yomiyasu/scripts/yomiyasu_lint.py shots/gametext.md`(trailing_colon はコード片への誤検出)

## 日本語の文章
- ゲーム内の文章(依頼文、ヒント、ガイド、チュートリアル、画面の文言)を書いたり直したりしたら、仕上げに yomiyasu で推敲する(`.devin/skills/yomiyasu/`、v3.1.0)
- 検査: 文章を標準入力で渡す `python .devin/skills/yomiyasu/scripts/yomiyasu_lint.py -`
- SKILL.md 中の `${CLAUDE_SKILL_DIR}` は `.devin/skills/yomiyasu` と読み替える

## 素材
- 画像は Gemini API で作る。キーはユーザー環境変数 `gemini`(レジストリ HKCU\Environment から読む)。キーを表示・記録しない
- 効果音は `src/ui/audio.ts` でその場で合成している(素材ファイルなし)
