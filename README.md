# SAFi

SAFi is a Node.js web app prototype for real-time detection of phone-based special fraud. It records short audio chunks in the browser, transcribes them with OpenAI's `gpt-4o-mini-transcribe`, sends the latest five utterances to the Node.js API, and detects fraud signals with `gpt-4.1-mini`.

## Models

| Purpose | Model |
| --- | --- |
| Audio transcription | `gpt-4o-mini-transcribe` |
| Fraud signal detection | `gpt-4.1-mini` |

The default implementation calls OpenAI cloud endpoints:

- Transcription: `https://api.openai.com/v1/audio/transcriptions` with model `gpt-4o-mini-transcribe`
- Detection: `https://api.openai.com/v1/chat/completions` with model `gpt-4.1-mini`

If the detection token is not configured, SAFi keeps the demo usable by falling back to a local keyword detector with the same JSON shape. Audio transcription requires an OpenAI API key because transcription runs server-side.

## Features

- Browser microphone recording with `MediaRecorder`.
- Server-side audio transcription through `gpt-4o-mini-transcribe`.
- Server-side fraud JSON detection through `gpt-4.1-mini` Structured Outputs.
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
export OPENAI_API_KEY="your-openai-api-key"
npm start
```

Open <http://localhost:3000>. For microphone transcription, use a browser that supports `MediaRecorder`. If microphone use is unavailable, use the manual input field.

## Configuration

```bash
# Shared API key for both OpenAI model calls.
export OPENAI_API_KEY="your-openai-api-key"

# Optional overrides.
export TRANSCRIPTION_API_KEY="your-openai-api-key-for-transcription"
export DETECTOR_API_KEY="your-openai-api-key-for-detection"
export TRANSCRIPTION_API_URL="https://api.openai.com/v1/audio/transcriptions"
export DETECTOR_API_URL="https://api.openai.com/v1/chat/completions"
export TRANSCRIPTION_MODEL="gpt-4o-mini-transcribe"
export DETECTOR_MODEL="gpt-4.1-mini"
```

## Scripts

- `npm start` - run the production server.
- `npm run dev` - run with Node.js watch mode.
- `npm test` - run Node.js unit tests.
