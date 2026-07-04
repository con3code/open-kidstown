# open-kidstown — キッズタウンのアプリ一式

「キッズタウン」は、子ども達が市役所・銀行・お店などの役割を分担して町を運営し、
社会のしくみを体験する活動です。このリポジトリは、その IT 環境をだれでも自分で
用意できるように公開しているアプリ一式です。

市民は IC カード (FeliCa) を「市民証 兼 お財布 兼 銀行口座」として使います。
データはすべて Firebase Firestore に置かれ、**マスターキー** (タウンの合言葉)
ひとつで全アプリが同じデータベースにつながります。

```
子どもが使う                          大人スタッフが使う
┌──────────────────────┐            ┌──────────────────────┐
│ Xcratch 窓口アプリ     │            │ Web 管理アプリ         │
│ ・市役所 (kt-cityhall) │  同じ      │ ・市民DB (citizen-db)  │
│ ・銀行   (kt-bank)     │← データ →  │ ・お店POS (shop-pos)   │
│ ・お店レジ (kt-shop)   │            │ ・ぎんこう (kids-bank) │
└──────────────────────┘            │ ・システム管理 (kt-sys) │
                                    └──────────────────────┘
```

## まず動かしてみる (5 分)

1. [マスターキーを用意](docs/setup.md#step-1-マスターキーを用意する)する (自分の Firebase プロジェクト + 合言葉の登録)
2. https://kidstown-citizen.web.app を開いてマスターキーを入力 → 市民を 1 人登録してみる
3. Chrome で [Xcratch エディタ](https://xcratch.github.io/editor/) を開き、
   [xcratch-apps/kt-bank.sb3](xcratch-apps/) を読み込んで旗をクリック → チャージしてみる

くわしい手順は **[docs/setup.md](docs/setup.md)** へ。

## リポジトリの構成

| フォルダ | 内容 |
|---|---|
| [docs/](docs/) | **セットアップ手順** と **窓口アプリの使い方** |
| [xcratch-apps/](xcratch-apps/) | Xcratch 窓口アプリ (sb3): 市役所 / 銀行 / お店レジ + 共通部品 |
| [citizen-db/](citizen-db/) | Web: 市民DB (市民台帳の管理) |
| [shop-pos/](shop-pos/) | Web: お店POS (売買記録の管理) |
| [kids-bank/](kids-bank/) | Web: ぎんこう (口座・入出金明細の管理) |
| [kt-sys/](kt-sys/) | Web: システム管理 (統計・一括リセット。運営者専用) |
| shared/ | Web アプリ共通ライブラリ (アプリを改造する人向け) |

各 Web アプリの概要・使い方は各フォルダの README に書いてあります。

## 必要なもの

| もの | 必須? | 備考 |
|---|---|---|
| Google アカウント | ✔ | Firebase (データベース) 用 |
| マスターキー | ✔ | [登録手順](docs/setup.md#step-1-マスターキーを用意する) |
| パソコン + Chrome | ✔ | 窓口アプリは Chrome / Edge のみ対応 |
| FeliCa カード (人数分) | ✔ | Suica / PASMO / nanaco 等の実カードで OK |
| カードリーダー SONY PaSoRi | 推奨 | RC-S380 等。なくてもキーボード入力で代用可 |
| Node.js 20+ | 任意 | Web アプリを自分でデプロイ・改造する場合のみ |

## 使っている技術

- [Xcratch](https://xcratch.github.io/) + 拡張 [numberbank](https://github.com/con3code/xcx-numberbank) (クラウド保存) / [pasorich](https://github.com/con3code/xcx-pasorich) (IC カード読取)
- Firebase Firestore / Hosting
- React + TypeScript + Vite (Web 管理アプリ)

## ライセンス

[MIT License](LICENSE)。numberbank / pasorich / MasterkeyBank は別プロジェクトであり、
それぞれのライセンスに従います。質問・不具合報告は GitHub Issues へどうぞ。
