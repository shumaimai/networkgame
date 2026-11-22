// 版の違い: 製品版と、Webで公開するお試し版
// お試し版は `npm run trial` で作る(環境変数 VITE_TRIAL=1 を付けてビルドする)

/** お試し版としてビルドしたとき true */
export const TRIAL: boolean = import.meta.env?.VITE_TRIAL === '1';
/** 上がるレベルの上限。お試し版は Lv.5 まで(サブネット分割と、2つのネットワークをルーターでつなぐところまで) */
export const LEVEL_CAP = TRIAL ? 5 : 24;
/** セーブの置き場所。お試し版と製品版を同じ場所で開いても、互いのセーブを上書きしない */
export const SAVE_KEY = TRIAL ? 'netshop-trial-save' : 'netshop-save';
/** お試し版で、上限のレベルに着いたときに出す文 */
export const TRIAL_END = 'お試し版で上がるレベルは Lv.5 までです。依頼は、このまま続けて受けられます。製品版では Lv.24 まで進み、DNSサーバー以降の内容(プロキシ、VLAN、ファイアウォール、VPN、冗長化、クラウドなど)を扱います。';
