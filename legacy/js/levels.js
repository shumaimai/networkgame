'use strict';
// 依頼(ステージ)定義
//   kind:     'build' 空の机から構築する / 'trouble' 既設のネットワークの不具合を直す
//   need:     この依頼が出るのに必要な納品済みの件数
//   internet: 机にインターネット回線の口があるか
//   supplied: お客様の機器。at:[x割合, y割合] があれば最初から机に置かれている(cfg は既設の設定)
//   cables:   既設のケーブル [機器A, ポートA, 機器B, ポートB](ルーターのポート: 0=WAN 1=LAN1 2=LAN2)
//   shop:     購入できる機材
//   reqs:     納品条件 (subnet / reach / noreach / internet / name / web / noDirectWeb / noProxy)
const LEVELS = [
  {
    id: 'l1', kind: 'build', need: 0, name: '田中税理士事務所', title: 'はじめての社内LAN', contract: 20000, par: 9500,
    brief: 'PC2台とプリンタを1台買ったんだけど、つなぎ方がわからなくてね。どのPCからも印刷できるようにしてほしい。アドレスは 192.168.1.0/24 でお願いします。',
    supplied: [
      { type: 'pc', id: 'pc1', name: 'PC-1' },
      { type: 'pc', id: 'pc2', name: 'PC-2' },
      { type: 'printer', id: 'prn1', name: 'プリンタ' },
    ],
    shop: ['l2'],
    reqs: [
      { t: 'subnet', devs: ['pc1', 'pc2', 'prn1'], cidr: '192.168.1.0/24', label: '全機器のIPが 192.168.1.0/24 の範囲内' },
      { t: 'reach', from: ['pc1', 'pc2'], to: 'prn1', label: 'PC-1 / PC-2 からプリンタに通信できる' },
      { t: 'reach', from: ['pc1'], to: 'pc2', label: 'PC同士で通信できる' },
    ],
    hints: [
      '右のパレットから PC-1・PC-2・プリンタ と L2スイッチ を机にドラッグして並べます。',
      '機器のポート(小さな四角)をクリック → スイッチのポートをクリックでLANケーブルをつなぎます。',
      '机の上の機器をクリックすると設定が開きます。IPアドレスの例: 192.168.1.10 / 192.168.1.11 / 192.168.1.200',
    ],
  },
  {
    id: 'l2', kind: 'build', need: 1, name: 'カフェ・ポラリス', title: 'インターネット開通', contract: 45000, par: 30500,
    brief: '事務所のPC2台とプリンタをインターネットにつなぎたいんです。回線は契約済みで、机の奥に口が来ています。アドレスは 192.168.10.0/24、DNSはプロバイダから 8.8.8.8 を使うよう言われています。',
    internet: true,
    supplied: [
      { type: 'pc', id: 'pc1', name: 'PC-1' },
      { type: 'pc', id: 'pc2', name: 'PC-2' },
      { type: 'printer', id: 'prn1', name: 'プリンタ' },
    ],
    shop: ['l2', 'router'],
    reqs: [
      { t: 'subnet', devs: ['pc1', 'pc2', 'prn1'], cidr: '192.168.10.0/24', label: '全機器のIPが 192.168.10.0/24 の範囲内' },
      { t: 'reach', from: ['pc1', 'pc2'], to: 'prn1', label: 'PCからプリンタに通信できる' },
      { t: 'internet', from: ['pc1', 'pc2'], label: 'PCからインターネット(8.8.8.8)に通信できる' },
      { t: 'web', from: ['pc1', 'pc2'], name: 'www.example.com', label: 'PCで www.example.com を開ける' },
    ],
    hints: [
      'ルーターのWANポートをインターネット回線へ、LAN1をL2スイッチへつなぎます。',
      'ルーターのLAN1に 192.168.10.1 を設定し、各PCのデフォルトゲートウェイを 192.168.10.1 にします。',
      'Webサイトを名前で開くにはDNSが必要です。PCのDNSサーバー欄に 8.8.8.8 を設定しましょう。',
    ],
  },
  {
    id: 't1', kind: 'trouble', need: 1, name: 'さくら歯科', title: '急に印刷できなくなった', contract: 15000, par: 500,
    brief: '昨日、院内の模様替えをしてから、どのPCからも印刷できなくなりました。受付のPCは新しく入れ替えたばかりです。アドレスは 192.168.1.0/24 のはずなんですが…。',
    supplied: [
      { type: 'l2', id: 'sw', name: 'スイッチ', at: [0.5, 0.42] },
      { type: 'pc', id: 'pc1', name: '診察室PC', at: [0.28, 0.8], cfg: { ip: '192.168.1.11' } },
      { type: 'pc', id: 'pc2', name: '受付PC', at: [0.5, 0.8], cfg: { ip: '192.168.11.12' } },
      { type: 'printer', id: 'prn1', name: 'プリンタ', at: [0.72, 0.8], cfg: { ip: '192.168.1.200' } },
    ],
    cables: [['pc1', 0, 'sw', 0], ['pc2', 0, 'sw', 1]],
    shop: ['l2'],
    reqs: [
      { t: 'subnet', devs: ['pc1', 'pc2', 'prn1'], cidr: '192.168.1.0/24', label: '全機器のIPが 192.168.1.0/24 の範囲内' },
      { t: 'reach', from: ['pc1', 'pc2'], to: 'prn1', label: '診察室PC / 受付PC からプリンタに通信できる' },
    ],
    hints: [
      'まずは配線を目で確認します。ケーブルがつながっていないポートは灰色のままです。',
      'PCを選んで診断ツールの ping をプリンタのIPに打つと、どこで止まるかが分かります。',
      '受付PCのIPアドレスをよく見てください。192.168.1.x になっていますか?',
    ],
  },
  {
    id: 't2', kind: 'trouble', need: 2, name: 'ひまわり保育園', title: 'インターネットにつながらない', contract: 25000, par: 0,
    brief: '業者さんに設定してもらったはずなのに、どのPCもインターネットにつながりません。園長のPCは先週から調子が悪く、ほかは昨日ルーターを置き直してからです。',
    internet: true,
    supplied: [
      { type: 'router', id: 'rt', name: 'ルーター', at: [0.5, 0.32], cfg: { lan: [{ ip: '192.168.1.1', prefix: 24 }, { ip: '', prefix: 24 }] } },
      { type: 'l2', id: 'sw', name: 'スイッチ', at: [0.5, 0.54] },
      { type: 'pc', id: 'pc1', name: '職員室PC-1', at: [0.26, 0.84], cfg: { ip: '192.168.1.11', gw: '192.168.1.1', dns: '8.8.8.8' } },
      { type: 'pc', id: 'pc2', name: '職員室PC-2', at: [0.5, 0.84], cfg: { ip: '192.168.1.12', gw: '192.168.1.1', dns: '8.8.4.8' } },
      { type: 'pc', id: 'pc3', name: '園長PC', at: [0.74, 0.84], cfg: { ip: '192.168.1.13', gw: '192.168.1.254', dns: '8.8.8.8' } },
    ],
    cables: [['inet', 0, 'rt', 2], ['rt', 1, 'sw', 0], ['pc1', 0, 'sw', 1], ['pc2', 0, 'sw', 2], ['pc3', 0, 'sw', 3]],
    shop: ['l2', 'router'],
    reqs: [
      { t: 'internet', from: ['pc1', 'pc2', 'pc3'], label: '全PCからインターネット(8.8.8.8)に通信できる' },
      { t: 'web', from: ['pc1', 'pc2', 'pc3'], name: 'www.example.com', label: '全PCで www.example.com を開ける' },
    ],
    hints: [
      'インターネット回線は、ルーターのどのポートにつながっていますか? 外したお客様のケーブルは無料でつなぎ直せます。',
      '園長PCのデフォルトゲートウェイは、ルーターのLAN1のIPと一致していますか?',
      '診断ツールの nslookup で www.example.com を引いてみましょう。DNSサーバーのアドレスに打ち間違いがあるPCがあります。',
    ],
  },
  {
    id: 'l3', kind: 'build', need: 3, name: 'みどり設計事務所', title: '社内DNSサーバーを立てる', contract: 95000, par: 56000,
    brief: 'プリンタに printer.midori.local という名前で印刷できるようにしたいんです。社内にDNSサーバーを立ててください。アドレスは 192.168.1.0/24 で。もちろんWebも見られるようにお願いします。',
    internet: true,
    supplied: [
      { type: 'pc', id: 'pc1', name: 'PC-1' },
      { type: 'pc', id: 'pc2', name: 'PC-2' },
      { type: 'printer', id: 'prn1', name: 'プリンタ' },
    ],
    shop: ['l2', 'router', 'server'],
    reqs: [
      { t: 'subnet', devs: ['pc1', 'pc2', 'prn1'], cidr: '192.168.1.0/24', label: 'PCとプリンタのIPが 192.168.1.0/24 の範囲内' },
      { t: 'name', from: ['pc1', 'pc2'], name: 'printer.midori.local', to: 'prn1', label: 'PCから printer.midori.local でプリンタに印刷できる' },
      { t: 'web', from: ['pc1', 'pc2'], name: 'www.example.com', label: 'PCで www.example.com を開ける' },
    ],
    hints: [
      'サーバーを購入してスイッチにつなぎ、IPアドレスとゲートウェイを設定して「DNSサービスを動かす」をオンにします。',
      'DNSのレコードに printer.midori.local → プリンタのIPアドレス を登録します。',
      'Webサイトなど外部の名前は、フォワーダー(8.8.8.8)へ転送して調べます。サーバー自身がインターネットに出られる必要があります。',
      'PCのDNSサーバー欄には、立てたサーバーのIPを指定します。8.8.8.8 では社内の名前は引けません。',
    ],
  },
  {
    id: 'l4', kind: 'build', need: 4, name: '北斗商事', title: 'Webはプロキシ経由で', contract: 130000, par: 56500,
    brief: '情報漏えい対策で、社員PCのWebアクセスは必ずプロキシサーバーを通したい。PCから直接インターネットのWebには出られないようにしてくれ。ついでにプリンタにも printer.hokuto.local という名前で印刷できるように。アドレスは 192.168.1.0/24 で頼む。',
    internet: true,
    supplied: [
      { type: 'pc', id: 'pc1', name: 'PC-1' },
      { type: 'pc', id: 'pc2', name: 'PC-2' },
      { type: 'pc', id: 'pc3', name: 'PC-3' },
      { type: 'printer', id: 'prn1', name: 'プリンタ' },
    ],
    shop: ['l2', 'router', 'server'],
    reqs: [
      { t: 'subnet', devs: ['pc1', 'pc2', 'pc3', 'prn1'], cidr: '192.168.1.0/24', label: 'PCとプリンタのIPが 192.168.1.0/24 の範囲内' },
      { t: 'web', from: ['pc1', 'pc2', 'pc3'], name: 'www.example.com', via: 'proxy', label: '全PCがプロキシ経由で www.example.com を開ける' },
      { t: 'noDirectWeb', from: ['pc1', 'pc2', 'pc3'], label: 'PCから直接Webには出られない' },
      { t: 'name', from: ['pc1', 'pc2', 'pc3'], name: 'printer.hokuto.local', to: 'prn1', label: '全PCから printer.hokuto.local でプリンタに印刷できる' },
    ],
    hints: [
      'サーバーで「プロキシサービスを動かす」をオンにし、PCのプロキシ欄に サーバーのIP:待受ポート(例 192.168.1.53:8080)を設定します。',
      'プロキシはPCの代わりに名前解決とWebアクセスをします。サーバー自身にゲートウェイと参照DNSが必要です(同じサーバーでDNSサービスを動かすなら参照DNSは空欄で可)。',
      '直接アクセスの遮断は、ルーターのファイアウォールを「指定した送信元のみ」にして、プロキシサーバーのIPだけを許可します。',
      'DNSとプロキシは1台のサーバーで両方動かせます。機材費の節約になります。',
    ],
  },
  {
    id: 'l5', kind: 'build', need: 5, name: 'あおば製作所', title: '部署ごとにネットワークを分ける', contract: 220000, par: 95000,
    brief: '営業部と開発部でネットワークを分けたい。営業は 192.168.10.0/24、開発は 192.168.20.0/24。プリンタは prn-eigyo.aoba.local と prn-kaihatsu.aoba.local という名前で使えるようにして、営業部からも開発部のプリンタで印刷できるようにしておいてくれ。もちろん全員インターネットは使う。',
    internet: true,
    supplied: [
      { type: 'pc', id: 's1', name: '営業PC-1' },
      { type: 'pc', id: 's2', name: '営業PC-2' },
      { type: 'pc', id: 's3', name: '営業PC-3' },
      { type: 'printer', id: 'sprn', name: '営業プリンタ' },
      { type: 'pc', id: 'd1', name: '開発PC-1' },
      { type: 'pc', id: 'd2', name: '開発PC-2' },
      { type: 'printer', id: 'dprn', name: '開発プリンタ' },
    ],
    shop: ['l2', 'l3', 'router', 'server'],
    reqs: [
      { t: 'subnet', devs: ['s1', 's2', 's3', 'sprn'], cidr: '192.168.10.0/24', label: '営業部の機器が 192.168.10.0/24 の範囲内' },
      { t: 'subnet', devs: ['d1', 'd2', 'dprn'], cidr: '192.168.20.0/24', label: '開発部の機器が 192.168.20.0/24 の範囲内' },
      { t: 'name', from: ['s1', 's2', 's3'], name: 'prn-eigyo.aoba.local', to: 'sprn', label: '営業PCから prn-eigyo.aoba.local で営業プリンタに印刷できる' },
      { t: 'name', from: ['d1', 'd2', 's1', 's2', 's3'], name: 'prn-kaihatsu.aoba.local', to: 'dprn', label: '開発PC・営業PCから prn-kaihatsu.aoba.local で開発プリンタに印刷できる' },
      { t: 'web', from: ['s1', 's2', 's3', 'd1', 'd2'], name: 'www.example.com', label: '全PCで www.example.com を開ける' },
    ],
    hints: [
      'L3スイッチはポートごとにVLANを割り当て(例: 営業=10、開発=20)、VLANインターフェースにIP(例: 192.168.10.254)を設定するとVLAN間を中継します。各PCのゲートウェイはそのIPです。',
      'L3スイッチとルーターの間にも1つネットワークが必要です。L3スイッチにデフォルトルート 0.0.0.0/0 → ルーターのIP を追加します。',
      'ルーターは営業・開発のネットワークを知りません。スタティックルート(例: 192.168.10.0/24 → L3スイッチのIP)で戻り道を教えます。',
      'L3スイッチは8ポートです。足りない分はL2スイッチを足すか、ルーターのLAN2にサーバーを直結します。',
    ],
  },
  {
    id: 't3', kind: 'trouble', need: 6, name: 'つばめ出版', title: '営業部だけネットが使えない', contract: 60000, par: 0,
    brief: '先月の席替えのあと、営業部だけインターネットが使えなくなりました。それと、プリンタを買い替えてから printer.tsubame.local という名前で印刷できません。編集部は 192.168.10.0/24、営業部は 192.168.20.0/24 です。前の業者とは連絡がつかなくて…。',
    internet: true,
    supplied: [
      { type: 'router', id: 'rt', name: 'ルーター', at: [0.5, 0.3], cfg: {
        lan: [{ ip: '10.0.0.1', prefix: 30 }, { ip: '192.168.100.1', prefix: 24 }],
        routes: [{ dest: '192.168.10.0/24', via: '10.0.0.2' }, { dest: '192.168.20.0/24', via: '10.0.0.3' }],
      } },
      { type: 'l3', id: 'l3', name: 'L3スイッチ', at: [0.42, 0.52], cfg: {
        portVlan: [10, 10, 10, 20, 10, 1, 1, 99],
        svis: [{ vlan: 10, ip: '192.168.10.254', prefix: 24 }, { vlan: 20, ip: '192.168.20.254', prefix: 24 }, { vlan: 99, ip: '10.0.0.2', prefix: 30 }],
        routes: [{ dest: '0.0.0.0/0', via: '10.0.0.1' }],
      } },
      { type: 'server', id: 'srv', name: 'サーバー', at: [0.84, 0.46], cfg: {
        ip: '192.168.100.53', gw: '192.168.100.1', dnsOn: true, forwarder: '8.8.8.8',
        records: [{ name: 'printer.tsubame.local', ip: '192.168.10.20' }],
      } },
      { type: 'pc', id: 'e1', name: '編集PC-1', at: [0.12, 0.85], cfg: { ip: '192.168.10.11', gw: '192.168.10.254', dns: '192.168.100.53' } },
      { type: 'pc', id: 'e2', name: '編集PC-2', at: [0.27, 0.85], cfg: { ip: '192.168.10.12', gw: '192.168.10.254', dns: '192.168.100.53' } },
      { type: 'printer', id: 'eprn', name: 'プリンタ', at: [0.42, 0.85], cfg: { ip: '192.168.10.200', gw: '192.168.10.254' } },
      { type: 'pc', id: 's1', name: '営業PC-1', at: [0.6, 0.85], cfg: { ip: '192.168.20.11', gw: '192.168.20.254', dns: '192.168.100.53' } },
      { type: 'pc', id: 's2', name: '営業PC-2', at: [0.75, 0.85], cfg: { ip: '192.168.20.12', gw: '192.168.20.254', dns: '192.168.100.53' } },
    ],
    cables: [
      ['inet', 0, 'rt', 0], ['l3', 7, 'rt', 1], ['srv', 0, 'rt', 2],
      ['e1', 0, 'l3', 0], ['e2', 0, 'l3', 1], ['eprn', 0, 'l3', 2], ['s1', 0, 'l3', 3], ['s2', 0, 'l3', 4],
    ],
    shop: ['l2', 'l3', 'router', 'server'],
    reqs: [
      { t: 'web', from: ['e1', 'e2', 's1', 's2'], name: 'www.example.com', label: '全PCで www.example.com を開ける' },
      { t: 'name', from: ['e1', 'e2', 's1', 's2'], name: 'printer.tsubame.local', to: 'eprn', label: '全PCから printer.tsubame.local でプリンタに印刷できる' },
    ],
    hints: [
      '営業PC-1 から ping 8.8.8.8 を打つと「行きは届くが戻りが失敗」と出ます。戻り道を知っているのはルーターのスタティックルートです。',
      '営業PC-2 はゲートウェイにすら届きません。L3スイッチのポートのVLAN番号(ポートの下の数字)を見比べてみましょう。',
      'プリンタは買い替えでIPアドレスが変わっています。サーバーのDNSレコードは古いままではありませんか?',
    ],
  },
  {
    id: 'l6', kind: 'build', need: 7, name: 'ホテル白樺', title: 'ゲスト用ネットワークの分離', contract: 300000, par: 94000,
    brief: '事務所のPCはプロキシ経由でしかWebを見られないようにしたい。一方、お客様用のゲストPCはインターネットだけ自由に使えて、事務所の機器にも社内のプロキシにも一切触れないようにしてください。事務は 192.168.10.0/24、ゲストは 192.168.50.0/24。事務のプリンタは printer.shirakaba.local で使えるように。',
    internet: true,
    supplied: [
      { type: 'pc', id: 'o1', name: '事務PC-1' },
      { type: 'pc', id: 'o2', name: '事務PC-2' },
      { type: 'printer', id: 'oprn', name: '事務プリンタ' },
      { type: 'pc', id: 'g1', name: 'ゲストPC-1' },
      { type: 'pc', id: 'g2', name: 'ゲストPC-2' },
    ],
    shop: ['l2', 'l3', 'router', 'server'],
    reqs: [
      { t: 'subnet', devs: ['o1', 'o2', 'oprn'], cidr: '192.168.10.0/24', label: '事務所の機器が 192.168.10.0/24 の範囲内' },
      { t: 'subnet', devs: ['g1', 'g2'], cidr: '192.168.50.0/24', label: 'ゲストPCが 192.168.50.0/24 の範囲内' },
      { t: 'web', from: ['o1', 'o2'], name: 'www.example.com', via: 'proxy', label: '事務PCがプロキシ経由で www.example.com を開ける' },
      { t: 'noDirectWeb', from: ['o1', 'o2'], label: '事務PCから直接Webには出られない' },
      { t: 'name', from: ['o1', 'o2'], name: 'printer.shirakaba.local', to: 'oprn', label: '事務PCから printer.shirakaba.local で事務プリンタに印刷できる' },
      { t: 'web', from: ['g1', 'g2'], name: 'www.example.com', label: 'ゲストPCで www.example.com を開ける' },
      { t: 'noreach', from: ['g1', 'g2'], to: ['o1', 'o2', 'oprn'], label: 'ゲストPCから事務所の機器に通信できない' },
      { t: 'noProxy', from: ['g1', 'g2'], label: 'ゲストPCから社内のプロキシを使えない' },
    ],
    hints: [
      '考え方は「部署ごとにネットワークを分ける」と同じです。事務・ゲスト・サーバーの3つのVLANをL3スイッチに作ります。',
      'ゲスト→事務の遮断は、L3スイッチの通信拒否ルールに 192.168.50.0/24 → 192.168.10.0/24 を追加します。',
      'プロキシの「利用を許可」に事務のネットワーク(192.168.10.0/24)だけを入れると、ゲストからは使えなくなります。',
      'ルーターのファイアウォールの許可リストに、プロキシサーバーのIPとゲストのネットワーク(192.168.50.0/24)をカンマ区切りで並べます。',
    ],
  },
];
