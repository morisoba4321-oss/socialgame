# 英検タワーディフェンス — 完全無料版（AI課金なし）

iPhoneのSafari/PWAで動かすことを前提にした、単語学習ゲームです。
**APIキーは一切不要**で、静的ファイルだけで動作します。

## 構成

- `index.html` — 画面
- `styles.css` — スタイル
- `app.js` — ゲーム本体
- `sentence-engine.js` — 例文の品詞・文法チェック（オフライン、API不使用）
- `sw.js` — PWA用Service Worker
- `manifest.webmanifest` — ホーム画面追加用

## 例文の取得の流れ（すべて無料）

1. 手動で確認済みの安全な例文（`SAFE_PATTERNS`）があればそれを使う
2. 単語データに付属する例文（`exampleFromSeed`）があればそれを使う
3. **Tatoeba**（多言語例文コーパス、無料公開API）と
   **Free Dictionary API**（`dictionaryapi.dev`、無料公開API）に問い合わせ、
   人間が実際に書いた自然な例文を取得する
4. 見つからない場合のみ、意味カテゴリごとに用意したローカルテンプレート
   （`buildLocalContextExample`）を使う
5. それも無ければ、品詞ベースの汎用テンプレート
   （`buildAIStyleExample`）を最終手段として使う

3の人間が書いた実例文を最優先にすることで、無料のままでも
「機械的で不自然な文」が出る頻度を大きく減らしています。
取得したすべての例文は、対象の単語が正しい品詞・文法枠で
使われているか（`sentence-engine.js`の`grammarCompatible`）を
必ずチェックしてから出題されます。

## デプロイ

サーバー側の処理（Vercel Function、環境変数）は不要になりました。
このフォルダをそのまま、以下のような無料の静的ホスティングに置くだけで動きます。

- Vercel（Static/Other プロジェクトとしてImport。Build Command不要）
- GitHub Pages
- Netlify（Drag & Dropでも可）
- Cloudflare Pages

## iPhone

HTTPSで公開したURLをSafariで開き、共有メニューから
「ホーム画面に追加」を選ぶとPWAとして起動できます。

## 注意

Tatoeba・Free Dictionary APIはどちらも無料の公開APIですが、
外部サービスであるため利用規約の範囲内でご利用ください。
ネットワークが使えない環境では自動的にローカルテンプレートに
切り替わるため、オフラインでもゲーム自体は継続できます。
