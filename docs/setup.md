# セットアップ手順 — ゼロから自分のタウンを作る

プログラミングやクラウドにくわしくない方でも順番に進めれば完成するように、
すべての手順を説明します。

## Step 1: マスターキーを用意する

**マスターキー**はタウンの合言葉です。1 タウン = 1 マスターキー。
これを知っているアプリだけが、あなたのタウンのデータベースにつながります。

発行 (MasterkeyBank への登録) の手順はこちらのスライドで紹介しています:

**→ [マスターキー登録手順のスライド](https://docs.google.com/presentation/d/1vPVuxgpPJBYHSX4UnXqe4M1FWAFQ_AhcDBSMf56Fa3o/edit?usp=sharing)**

ポイント:
- 自分の Google アカウントで Firebase プロジェクトを作り、Firestore を有効にします
- マスターキーは「他人が推測しにくい文字列」にし、**運営スタッフ以外に教えない**でください
  (マスターキーを知っている人は、タウンの全データを読み書きできます)

### Firestore のセキュリティルール

Firebase コンソール → Firestore Database → ルール に以下を貼り付けて公開します
(窓口アプリがログインなしで読み書きするために必要です):

```rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /card/{docId} {
      allow read: if true;
      allow write: if request.resource.data.keys().hasAll(
                      ['number','bank_key','card_key','master_key','time_stamp'])
                   && request.resource.data.bank_key is string
                   && request.resource.data.card_key is string
                   && request.resource.data.master_key is string;
      allow delete: if true;
    }
    match /bank/{docId} {
      allow read, write: if true;
    }
    match /{other=**} { allow read, write: if false; }
  }
}
```

### マスターキーの動作確認

1. Chrome で [Xcratch エディタ](https://xcratch.github.io/editor/) を開く
2. 「拡張機能を追加」→ Extension Loader →
   `https://con3code.github.io/xcx-numberbank/dist/numberbank.mjs`
3. `set Master [あなたのマスターキー]` → `put [10] to [test] of [test]` →
   `value of [test] of [test]` が 10 になれば成功

## Step 2: Web 管理アプリを使えるようにする

**2 つの方法**があります。かんたんな順に:

### 方法 A: 公開されているものをそのまま使う (最短・おすすめ)

以下の URL を開き、あなたのマスターキーを入力するだけです。
**データはマスターキーごとに完全に分かれる**ため、ホスティングを共有しても
他のタウンからあなたのデータは見えません。

- 市民DB: https://kidstown-citizen.web.app
- お店POS: https://kidstown-shop.web.app
- ぎんこう: https://kidstown-bank.web.app
- システム管理: https://kidstown-sys.web.app (リセット・掃除。運営者だけが使う)

### 方法 B: 自分の Firebase にデプロイする (自分で管理したい場合)

1. **Node.js をインストール** — https://nodejs.org/ から LTS 版 (20 以上)
2. **このリポジトリを取得**
   ```sh
   git clone https://github.com/con3code/open-kidstown.git
   cd open-kidstown
   npm install
   ```
3. **手元で動かしてみる** (デプロイ前の確認)
   ```sh
   npm run dev:citizen-db     # http://localhost:5301 が開けたら OK
   ```
4. **デプロイ先を設定** — 各アプリのフォルダで `.firebaserc` を作ります:
   ```sh
   cd citizen-db
   cp .firebaserc.example .firebaserc
   ```
   `.firebaserc` の `REPLACE_WITH_YOUR_FIREBASE_PROJECT_ID` を Step 1 で作った
   自分のプロジェクト ID に書き換えます
5. **ビルドしてデプロイ**
   ```sh
   npx firebase-tools login       # 初回のみ
   npm run build
   npx firebase-tools deploy --only hosting
   ```
   → `https://<プロジェクトID>.web.app` で開けます

**複数のアプリを同じプロジェクトに置く場合** (2 本目以降):
Firebase Hosting の[マルチサイト機能](https://firebase.google.com/docs/hosting/multisites)でサイトを追加し、
各アプリの `firebase.json` の `hosting` に `"site"` を足してからデプロイします。

```sh
npx firebase-tools hosting:sites:create mytown-shop --project <プロジェクトID>
```
```json
{ "hosting": { "site": "mytown-shop", "public": "dist", ... } }
```
→ `https://mytown-shop.web.app`。kids-bank / kt-sys も同様に。

## Step 3: Xcratch 窓口アプリを動かす

1. [../xcratch-apps/](../xcratch-apps/) の sb3 をダウンロード
   (`kt-cityhall.sb3` = 市役所 / `kt-bank.sb3` = 銀行 / `kt-shop.sb3` = お店レジ)
2. Chrome で [Xcratch エディタ](https://xcratch.github.io/editor/) を開き、sb3 を読み込む
3. 旗をクリック → マスターキーを聞かれるので入力
4. PaSoRi を USB につなぎ、画面の「ぱそり」の Connect 操作でデバイスを選択
   (PaSoRi がないときは、カード読み取り画面で**スペースキー**を押すと手入力できます)

各窓口アプリの操作方法: **→ [xcratch-apps.md](xcratch-apps.md)**

## Step 4: タウンを運営してみる (リハーサル)

1. **市役所** (kt-cityhall): 「とうろく」でスタッフを 1 人市民登録 → カードをかざす
2. **市民DB Web**: 登録した市民が一覧に出ることを確認
3. **市役所**: 「おいわいきん」で 500 えんふりこむ
4. **銀行** (kt-bank): チャージ 300 → ざんだか照会が 800 になる
5. **お店POS Web**: お店 (例 B06) を登録
6. **レジ** (kt-shop): 買い物 → 残高が減り、お店POS Web に取引が出る
7. **ぎんこう Web**: 明細 (口座開設 / お祝い金 / チャージ / 支払い) がそろっていれば合格!

本番前のテストデータの掃除は、システム管理アプリ (kt-sys) の「タウン全体リセット」が便利です。

## こまったときは

| 症状 | 対処 |
|---|---|
| 「マスターキーが違います」 | 入力ミス / MasterkeyBank 未登録。Step 1 を確認 |
| Web で「not allowed / permission-denied」 | Firestore ルールが閉じている。Step 1 のルールを設定 |
| 一覧に「インデックスが必要」のエラー | エラー内のリンクをクリックして Firestore の複合インデックスを作成 (1 回だけ) |
| PaSoRi が反応しない | Chrome か? USB 選択したか? 他のソフト (Suica 系アプリ等) が掴んでいないか? |
| 窓口アプリの書込みが「しっぱい」する | 会場のネット接続を確認。「last error」の表示 (cannot connect 等) がヒント |
| Web の一覧が空 | マスターキーが違う (別タウンを見ている) ことが大半 |

それでも解決しないときは、GitHub の Issues で質問してください。
