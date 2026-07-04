# @kidstown/shared — Web アプリ共通ライブラリ

4 つの Web 管理アプリが共有する内部ライブラリです (アプリを改造する開発者向け)。

- `masterkey.ts` — マスターキーから Firebase 設定を解決して接続
- `nbclient.ts` — numberbank 互換の Firestore 読み書き (put / change / 列挙 / 一括削除)
- `namespace.ts` — データの置き場所 (アドレス) の規約とレコード型
- `csv.ts` — CSV 入出力 (RFC 4180)
- `ui/` — マスターキー入力画面・一覧テーブルなどの共有 React コンポーネント

テスト: `npm test` (リポジトリルートで実行)
