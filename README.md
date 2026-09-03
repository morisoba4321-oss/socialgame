# 英検タワーディフェンス — 完全無料版（Gemini API / Cloudflare Pages）

iPhoneのSafari/PWAで動かすことを前提にした単語学習ゲームです。
課金は一切不要。Google AI StudioのGemini APIの**無料枠**（クレジットカード登録不要）を使います。
サーバー処理はCloudflare Pages Functionsで動かします。

## 構成

- `index.html` — 画面
- `styles.css` — スタイル
- `app.js` — ゲーム本体
- `sentence-engine.js` — AI例文生成の呼び出し・検証・IndexedDBキャッシュ
- `functions/api/generate-example.js` — Cloudflare Pages Function。
  Gemini APIをサーバー側から呼び出す（パスがそのままルートになるので、
  このファイルは `/api/generate-example` として呼び出される）
- `sw.js` — PWA用Service Worker
- `manifest.webmanifest` — ホーム画面追加用
- `.env.example` — 必要な環境変数の見本

> ⚠️ Cloudflare PagesとVercelはサーバー関数の書き方が異なります。
> Vercelは `api/*.js` に `export default function handler(req, res)`、
> Cloudflareは `functions/*.js` に `export function onRequestPost(context)`
> という形式が必要です。フォルダを間違えると（`api/`のままだと）
> Cloudflareでは関数が一切呼ばれず、常にローカルテンプレートの
> 不自然な文にフォールバックしてしまうので注意してください。

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
`sentence-engine.js`の`grammarCompatible`で必ずチェックしてから出題されます。

## Cloudflare Pagesへのデプロイ

### 1. GitHubへ配置

このフォルダをGitHubリポジトリのルートに置き、Cloudflare Pagesで
「Workers & Pages → Create → Pages → Connect to Git」からImportしてください。

- Build command: 空欄のまま（静的サイトなのでビルド不要）
- Build output directory: `/`（リポジトリのルート）

`functions/`フォルダは自動的に検出され、Pages Functionsとしてデプロイされます。

### 2. 無料のGemini APIキーを取得

1. [Google AI Studio](https://aistudio.google.com/apikey) にGoogleアカウントでログイン
2. 「Get API key」→「Create API key」でキーを発行（クレジットカード不要）

### 3. 環境変数を設定

CloudflareのダッシュボードでプロジェクトのSettings →
**Environment variables**（Production / Preview それぞれ）で次を追加します。

- `GEMINI_API_KEY` — 手順2で発行したキー（必須）。
  「Encrypt」にチェックを入れてSecretとして保存することを推奨します。
- `GEMINI_MODEL` — 任意。未設定なら `gemini-flash-lite-latest`

環境変数を追加・変更した後は再デプロイ（Retry deployment）してください。

### 4. 動作確認

デプロイ後、ブラウザから通常どおりゲームを開きます。
Cloudflareダッシュボードの当該デプロイ → **Functions** タブのログで、
`/api/generate-example` が200または429（無料枠のレート制限。異常ではない）
を返しているか確認してください。500番台のエラーが出る場合は、
`functions/api/generate-example.js` が正しく配置されているか、
環境変数名が`GEMINI_API_KEY`になっているかを確認してください。

## 無料枠についての注意

- Gemini APIの無料枠はクレジットカード不要ですが、**1分・1日あたりのリクエスト数に上限**があります。上限に達しても課金はされず、単にステップ5・6のローカルテンプレートに自動的に切り替わります。
- Googleの利用規約上、無料枠では入力・出力がモデル改善に使われる場合があります。個人の学習用途であれば通常は問題ありませんが、気になる場合は確認してください。
- `GEMINI_API_KEY`は絶対にブラウザ側コードに書かないでください。`functions/api/generate-example.js`内だけで`env.GEMINI_API_KEY`として使用します。

## iPhone

HTTPSで公開したCloudflare Pages URLをSafariで開き、共有メニューから
「ホーム画面に追加」を選ぶとPWAとして起動できます。
