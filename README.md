# 英検タワーディフェンス — 完全無料版（Gemini API / Cloudflare Workers）

iPhoneのSafari/PWAで動かすことを前提にした単語学習ゲームです。
課金は一切不要。Google AI StudioのGemini APIの**無料枠**（クレジットカード登録不要）を使います。

このプロジェクトはCloudflareの**Workers（static assets付き）**として構成されています。
Cloudflare Pages（`functions/`フォルダ方式）ではないので注意してください。
2026年時点でCloudflareは新規プロジェクトをこの統合Workers方式に誘導しており、
ダッシュボードのURLが`*.pages.dev`ではなく`*.workers.dev`になっているのはこのためです。

## 構成

- `wrangler.json` — Workers設定。`main`（Workerスクリプト）と
  `assets.directory`（静的ファイルの場所）を指定
- `worker.js` — Workerのエントリーポイント。`/api/generate-example`への
  リクエストだけをGemini API呼び出しとして処理し、それ以外は
  `env.ASSETS.fetch(request)`で`public/`内の静的ファイルをそのまま返す
- `public/` — 静的ファイル一式
  - `index.html` — 画面
  - `styles.css` — スタイル
  - `app.js` — ゲーム本体
  - `sentence-engine.js` — AI例文生成の呼び出し・検証・IndexedDBキャッシュ
  - `sw.js` — PWA用Service Worker
  - `manifest.webmanifest` — ホーム画面追加用
- `.env.example` — 必要な環境変数（Secret）の見本

## 例文の取得の流れ（すべて無料）

1. 手動で確認済みの安全な例文（`SAFE_PATTERNS`）があればそれを使う
2. 単語データに付属する例文（`exampleFromSeed`）があればそれを使う
3. **Tatoeba**（多言語例文コーパス）と**Free Dictionary API**
   （どちらも無料公開API・レート制限なし）に問い合わせ、
   人間が実際に書いた自然な例文を探す
4. 見つからなければ `/api/generate-example` 経由でGemini API（無料枠）に
   生成させる。無料枠のレート制限（1分・1日あたりの上限）に達した場合は
   自動的に次のステップへフォールバックする
5. それでも無ければ、意味カテゴリごとに用意したローカルテンプレート
6. 最後の手段として、品詞ベースの汎用テンプレート

すべての例文は、対象の単語が正しい品詞・文法枠で使われているかを
`public/sentence-engine.js`の`grammarCompatible`で必ずチェックしてから出題されます。

## デプロイ（Git連携 / Workers Builds）

すでにGitHubリポジトリをCloudflareに接続している場合、この構成一式を
リポジトリのルートに置いて`git push`するだけで、Cloudflareが
`wrangler.json`を検出し、自動的にビルド・デプロイします。
特別なBuild commandの設定は不要です。

### 環境変数（Secret）の設定

1. Cloudflareダッシュボードで対象のWorkersプロジェクトを開く
2. **Settings → Variables and Secrets** を開く
3. 次を追加：
   - `GEMINI_API_KEY` — [Google AI Studio](https://aistudio.google.com/apikey)
     で発行した無料APIキー（**Secret**として保存推奨）
   - `GEMINI_MODEL` — 任意。未設定なら`gemini-flash-lite-latest`
4. 保存後、再デプロイ（Git pushするか、ダッシュボードから再デプロイ）

### 動作確認（ログの確認方法）

1. Cloudflareダッシュボードでプロジェクトを開く
2. タブが `Overview / Metrics / Deployments / Bindings ...` のように並んでいる場合、
   スマホ画面ではタブが省略されるので、右端の**「...」（もっと見る）**をタップ
3. 出てきたメニューから **「Logs」または「Observability」** を選ぶ
4. 画面内の **「Live」** を選ぶとリアルタイムログのストリーミングが始まる
5. その状態のままアプリで単語を出題し、`/api/generate-example`への
   リクエストとステータスコードを確認する

ログが見当たらない・反応がない場合は、`worker.js`に埋め込んである
`console.log(...)`の出力（例：`[generate-example] success: "..."`)が
表示されるはずなので、それを目印に探してください。

パソコンが使える場合は、以下のコマンドで確実にログを追えます（要Node.js）。

```
npx wrangler tail
```

- 200 → Gemini生成成功
- 429 → 無料枠のレート制限（想定内。テンプレートに自動フォールバック）
- 503 → `GEMINI_API_KEY`が未設定
- 502 → Gemini側のエラーやタイムアウト

## 無料枠についての注意

- Gemini APIの無料枠はクレジットカード不要ですが、**1分・1日あたりのリクエスト数に上限**があります。上限に達しても課金はされず、単にローカルテンプレートに自動的に切り替わります。
- Googleの利用規約上、無料枠では入力・出力がモデル改善に使われる場合があります。個人の学習用途であれば通常は問題ありませんが、気になる場合は確認してください。
- `GEMINI_API_KEY`は絶対にブラウザ側コードに書かないでください。`worker.js`内だけで`env.GEMINI_API_KEY`として使用します。

## iPhone

HTTPSで公開されたWorkers URL（`*.workers.dev`または独自ドメイン）を
Safariで開き、共有メニューから「ホーム画面に追加」を選ぶとPWAとして
起動できます。
