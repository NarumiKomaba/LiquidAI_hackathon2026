# SAFi

SAFi is a Node.js web app prototype for real-time detection of phone-based special fraud. It records short audio chunks in the browser, transcribes them with `LiquidAI/LFM2.5-Audio-1.5B-JP`, sends the latest five utterances to the Node.js API, and detects fraud signals with `LiquidAI/LFM2.5-8B-A1B`.

## Models

| Purpose | Model |
| --- | --- |
| Audio transcription | `LiquidAI/LFM2.5-Audio-1.5B-JP` |
| Fraud signal detection | `LiquidAI/LFM2.5-8B-A1B` |

The default implementation calls Hugging Face-hosted LiquidAI endpoints:

- Transcription: `https://api-inference.huggingface.co/models/LiquidAI/LFM2.5-Audio-1.5B-JP`
- Detection: `https://router.huggingface.co/v1/chat/completions` with model `LiquidAI/LFM2.5-8B-A1B`

If the detection token is not configured, SAFi keeps the demo usable by falling back to a local keyword detector with the same JSON shape. Audio transcription requires a Hugging Face token because the LFM2.5-Audio-JP model runs server-side.

## Features

- Browser microphone recording with `MediaRecorder`.
- Server-side audio transcription through `LiquidAI/LFM2.5-Audio-1.5B-JP`.
- Server-side fraud JSON detection through `LiquidAI/LFM2.5-8B-A1B`.
- Weighted scoring over the latest five utterances, with extra risk synergy for common fraud patterns.
- Simple white UI during normal operation; when the danger threshold is exceeded, the screen shifts to red and shows a clear warning.
- Manual text input for demos and environments where microphone/API access is unavailable.

## LLM detector contract

The detector output is normalized to this JSON shape:

```json
{
  "is_authority": { "status": true, "text": "〇〇警察の生活安全課です" },
  "has_threat": { "status": true, "text": "あなたも疑われています" },
  "has_secrecy": { "status": true, "text": "捜査は秘密なので誰にも言わないで" },
  "ask_financial": { "status": true, "text": "今の残高はいくらですか" },
  "demand_action": { "status": true, "text": "今すぐATMにいけ" }
}
```

## Getting started

```bash
npm install
export HF_TOKEN="your-hugging-face-token"
npm start
```

Open <http://localhost:3000>. For microphone transcription, use a browser that supports `MediaRecorder`. If microphone use is unavailable, use the manual input field.

## Configuration

```bash
# Shared token for both LiquidAI model calls.
export HF_TOKEN="your-hugging-face-token"

# Optional overrides.
export TRANSCRIPTION_API_KEY="your-hugging-face-token-for-transcription"
export DETECTOR_API_KEY="your-hugging-face-token-for-detection"
export TRANSCRIPTION_API_URL="https://api-inference.huggingface.co/models/LiquidAI/LFM2.5-Audio-1.5B-JP"
export DETECTOR_API_URL="https://router.huggingface.co/v1/chat/completions"
export TRANSCRIPTION_MODEL="LiquidAI/LFM2.5-Audio-1.5B-JP"
export DETECTOR_MODEL="LiquidAI/LFM2.5-8B-A1B"
```

## Local inference adapter

SAFi can run against local fine-tuned LFM services instead of hosted Hugging Face endpoints. This is the intended path for the final hackathon demo once the fine-tuned `LFM2.5-Audio` and `LFM2.5` checkpoints are downloaded locally.

```bash
export INFERENCE_PROVIDER="local"
export TRANSCRIPTION_API_URL="http://localhost:8088/transcribe"
export DETECTOR_API_URL="http://localhost:8088/v1/chat/completions"
export TRANSCRIPTION_MODEL="/models/safi-lfm2.5-audio-jp"
export DETECTOR_MODEL="/models/safi-lfm2.5-detector"
npm start
```

The local transcription service should accept raw audio bytes and return JSON:

```http
POST /transcribe
Content-Type: audio/webm
X-SAFi-Model: /models/safi-lfm2.5-audio-jp
```

```json
{ "text": "文字起こし結果" }
```

The local detector service should expose an OpenAI-compatible chat completions endpoint, or return a direct `analysis` object:

```http
POST /v1/chat/completions
Content-Type: application/json
X-SAFi-Model: /models/safi-lfm2.5-detector
```

```json
{
  "choices": [
    {
      "message": {
        "content": "{\"is_authority\":{\"status\":true,\"text\":\"警察です\"},\"has_threat\":{\"status\":false,\"text\":\"\"},\"has_secrecy\":{\"status\":false,\"text\":\"\"},\"ask_financial\":{\"status\":false,\"text\":\"\"},\"demand_action\":{\"status\":false,\"text\":\"\"}}"
      }
    }
  ]
}
```

For local integration testing before the real model server exists:

```bash
npm run local:mock
```

Then run the app in another terminal:

```bash
export INFERENCE_PROVIDER="local"
export TRANSCRIPTION_API_URL="http://localhost:8088/transcribe"
export DETECTOR_API_URL="http://localhost:8088/v1/chat/completions"
npm start
```

When the fine-tuned models are ready, use `local_inference/real_server_template.py` as the replacement point. The template already contains the HTTP routes SAFi needs; fill in the four model-specific functions:

- `load_audio_model`
- `run_audio_transcription`
- `load_detector_model`
- `run_detector_generation`

## Scripts

- `npm start` - run the production server.
- `npm run dev` - run with Node.js watch mode.
- `npm run local:mock` - run a local inference-compatible mock server.
- `npm test` - run Node.js unit tests.
