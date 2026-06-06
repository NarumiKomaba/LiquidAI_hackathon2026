# SAFi

SAFi は、電話中の発話から特殊詐欺の兆候をリアルタイムに検知する Web アプリケーションです。

ブラウザで短い音声チャンクを録音し、音声文字起こしモデルでテキスト化します。その文字起こしテキストをそのまま評価し、特殊詐欺でよく使われる表現や誘導を詐欺シグナル JSON として抽出します。抽出したシグナルから会話全体の危険度スコアを計算し、危険度表示を更新します。

## 想定ユースケース

- 高齢者や家族が、通話中に詐欺の兆候へ早めに気づく
- 金融機関、自治体、見守りサービスなどで、電話応対中のリスクを補助的に確認する
- 日本語の特殊詐欺表現に合わせた LFM2.5-Audio-JP の活用デモ

## アプリの流れ

```mermaid
flowchart LR
  call[通話音声] --> audio[音声チャンク]
  audio --> transcript[文字起こしテキスト]
  transcript --> signals[詐欺シグナル JSON]
  signals --> score[会話全体のスコア]
  score --> risk[危険度表示 / danger mode]
```

録音した音声を短いチャンクごとに文字起こしし、そのテキストを fine-tuned model で詐欺シグナル JSON に変換します。Node.js 側で会話全体のシグナルをスコアリングし、ブラウザに危険度として表示します。

## 構成

```mermaid
flowchart LR
  browser[ブラウザ UI<br/>録音・履歴・危険度表示]
  node[SAFi Node.js API<br/>中継・履歴解析・スコアリング]
  local[ローカル推論サーバー<br/>fine-tuned LFM2.5-Audio-JP]

  browser -->|音声チャンク / 会話履歴| node
  node -->|音声バイナリ| local
  local -->|文字起こしテキスト| node
  node -->|文字起こしテキスト| local
  local -->|詐欺シグナル JSON| node
  node -->|スコア・危険度・根拠| browser
```

ブラウザは録音と表示を担当し、Node.js API はローカル推論サーバーへの中継と会話全体のスコアリングを担当します。モデル本体は Node.js には載せず、ローカル推論サーバー側で fine-tuned `LFM2.5-Audio-JP` を動かします。

## 使用モデル

| 用途 | モデル |
| --- | --- |
| 音声文字起こし | `LiquidAI/LFM2.5-Audio-1.5B-JP` |
| 詐欺シグナル判定 | `LiquidAI/LFM2.5-Audio-1.5B-JP` |

このアプリは、ローカル上の推論サーバーで fine-tuned `LFM2.5-Audio-JP` を起動し、文字起こしと詐欺シグナル判定の両方に使う構成です。

## 主な機能

- ブラウザのマイク録音
- 数秒ごとの音声チャンク送信
- LFM2.5-Audio-JP による日本語文字起こし
- fine-tuned LFM2.5-Audio-JP による特殊詐欺シグナル抽出
- 危険度が閾値を超えた場合の danger mode 表示
- 会話全体を使った危険度スコアリング
- 録音が使えない環境向けの手入力デモ
- ローカル推論API連携

## 検知するシグナル

fine-tuned model は、文字起こしテキストから以下の5つのシグナルを JSON で返します。

```json
{
  "is_authority": { "status": true, "text": "〇〇警察の生活安全課です" },
  "has_threat": { "status": true, "text": "あなたも疑われています" },
  "has_secrecy": { "status": true, "text": "捜査は秘密なので誰にも言わないで" },
  "ask_financial": { "status": true, "text": "今の残高はいくらですか" },
  "demand_action": { "status": true, "text": "今すぐATMにいけ" }
}
```

| キー | 意味 |
| --- | --- |
| `is_authority` | 警察、検察、銀行、自治体などの権威を名乗る |
| `has_threat` | 逮捕、凍結、犯罪などで不安をあおる |
| `has_secrecy` | 家族や他人に言わないよう指示する |
| `ask_financial` | 残高、口座、暗証番号、カード情報などを聞く |
| `demand_action` | ATM、送金、電子マネー購入などを急がせる |

## セットアップ

先に fine-tuned `LFM2.5-Audio-JP` をローカルに配置し、推論サーバーを起動します。

```txt
models/
  safi-lfm2.5-audio-jp-ft/
```

推論サーバーは、ローカルの fine-tuned model を読み込み、SAFi が必要とする2つのHTTPエンドポイントを提供します。

```bash
pip install -r local_inference/requirements.txt
export SAFI_MODEL_PATH="./models/safi-lfm2.5-audio-jp-ft"
uvicorn local_inference.server:app --host 127.0.0.1 --port 8088
```

別ターミナルで SAFi 本体を起動します。

```bash
npm install
npm start
```

起動後、ブラウザで開きます。

```txt
http://localhost:3000
```

マイク録音を使う場合は、`MediaRecorder` に対応したブラウザを使ってください。録音が使えない環境では、手入力欄から発話テキストを入力できます。

## ローカル推論API

SAFi は、ローカル上で起動した推論サーバーを HTTP API で呼び出します。

```txt
SAFi Node.js app
  ↓
Local inference server
  ├─ POST /transcribe
  └─ POST /v1/chat/completions
```

既定では次のローカルAPIを呼びます。

```txt
POST http://localhost:8088/transcribe
POST http://localhost:8088/v1/chat/completions
```

推論サーバーのURLやヘッダーに渡すモデル名を変える場合だけ、SAFi 本体側の環境変数で上書きできます。

```bash
export TRANSCRIPTION_API_URL="http://localhost:8088/transcribe"
export DETECTOR_API_URL="http://localhost:8088/v1/chat/completions"
export TRANSCRIPTION_MODEL="./models/safi-lfm2.5-audio-jp-ft"
export DETECTOR_MODEL="./models/safi-lfm2.5-audio-jp-ft"
npm start
```

## fine-tuned model API

### 音声文字起こし

SAFi は録音チャンクの音声バイナリを送り、ローカルの fine-tuned LFM2.5-Audio-JP から文字起こしテキストを受け取ります。

```http
POST /transcribe
Content-Type: audio/webm
X-SAFi-Model: ./models/safi-lfm2.5-audio-jp-ft
```

レスポンス:

```json
{
  "text": "文字起こし結果"
}
```

### 詐欺シグナル判定

SAFi は文字起こし済みテキストを送り、ローカルの fine-tuned LFM2.5-Audio-JP から詐欺シグナル JSON を受け取ります。推論サーバーは OpenAI 互換の `choices[0].message.content` に JSON 文字列を入れて返します。

```http
POST /v1/chat/completions
Content-Type: application/json
X-SAFi-Model: ./models/safi-lfm2.5-audio-jp-ft
```

レスポンス例:

```json
{
  "choices": [
    {
      "message": {
        "content": "{\"is_authority\":{\"status\":true,\"text\":\"警察です\"},\"has_threat\":{\"status\":false,\"text\":\"\"},\"has_secrecy\":{\"status\":true,\"text\":\"誰にも言わないで\"},\"ask_financial\":{\"status\":false,\"text\":\"\"},\"demand_action\":{\"status\":true,\"text\":\"今すぐATMに行って\"}}"
      }
    }
  ]
}
```

`detector.js` 側では、OpenAI互換形式のほか、直接 `analysis` オブジェクトを返す形式にも対応しています。

## ディレクトリ構成

```txt
.
├── public/
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   └── assets/
├── src/
│   ├── detector.js
│   ├── transcriber.js
│   └── models.js
├── local_inference/
│   ├── real_server_template.py
│   ├── requirements.txt
│   └── README.md
├── test/
├── server.js
└── package.json
```

## スクリプト

| コマンド | 説明 |
| --- | --- |
| `npm start` | SAFi本体を起動 |
| `npm run dev` | watch mode で開発起動 |
| `npm test` | Node.js のテストを実行 |

## 注意事項

- `models/` は `.gitignore` で除外しています。モデル本体はGitHubにコミットしないでください。
- `.env` もコミットしないでください。
- ローカル推論APIが起動していない場合、文字起こしと詐欺シグナル判定は失敗します。
- ハッカソン最終版では、ローカル推論サーバーに fine-tuned LFM2.5-Audio-JP を接続することで、LFM を使った構成として説明できます。
