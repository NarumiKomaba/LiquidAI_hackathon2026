"""
SAFi 最終版ローカル推論サーバーのテンプレートです。

このファイルは「そのまま動かす完成品」ではなく、
ファインチューニング済みモデルをどこで読み込み、どこで推論するかを示す足場です。

最終的にここへ差し込むもの:

1. 日本語文字起こし用の fine-tuned LFM2.5-Audio モデル
2. 特殊詐欺シグナル判定用の fine-tuned LFM2.5 テキストモデル

SAFi 本体側の想定設定:

    export INFERENCE_PROVIDER="local"
    export TRANSCRIPTION_API_URL="http://localhost:8088/transcribe"
    export DETECTOR_API_URL="http://localhost:8088/v1/chat/completions"
    export TRANSCRIPTION_MODEL="./models/safi-lfm2.5-audio-jp"
    export DETECTOR_MODEL="./models/safi-lfm2.5-detector"

このテンプレートでは FastAPI の形でAPIだけ先に固定しています。
実際にモデルを読み込む処理は、採用するランタイムによって変わります。

想定ランタイム例:
- Transformers
- ONNX Runtime
- llama.cpp
- liquid-audio
- vLLM
- SGLang
- Liquid AI が提供する専用ランタイム
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any

from fastapi import FastAPI, Request


AUDIO_MODEL_PATH = Path(os.getenv("SAFI_AUDIO_MODEL_PATH", "./models/safi-lfm2.5-audio-jp"))
DETECTOR_MODEL_PATH = Path(os.getenv("SAFI_DETECTOR_MODEL_PATH", "./models/safi-lfm2.5-detector"))

SIGNAL_KEYS = [
    "is_authority",
    "has_threat",
    "has_secrecy",
    "ask_financial",
    "demand_action",
]

SYSTEM_PROMPT = """あなたは電話特殊詐欺のリアルタイム検知器です。
入力発話を評価し、必ず次のJSONだけを返してください。
該当しない項目はstatusをfalse、textを空文字にしてください。
キーは is_authority, has_threat, has_secrecy, ask_financial, demand_action です。
"""

app = FastAPI(title="SAFi Local LFM Inference")


def load_audio_model(model_path: Path) -> Any:
    """LFM2.5-Audio のモデルを読み込む関数です。

    ここに書くこと:
    - `model_path` に置いた fine-tuned LFM2.5-Audio モデルを読み込む
    - 読み込んだモデルや推論セッションを返す
    - サーバー起動時に1回だけ呼ばれる想定なので、重い初期化はここに書く

    実装例の方向性:
    - liquid-audio runtime でローカルcheckpointを読み込む
    - Transformers / Optimum で Hugging Face 形式のモデルを読み込む
    - ONNX Runtime の session を作る
    - 専用CLIを subprocess で起動して、そのハンドルを返す

    返り値:
    - `run_audio_transcription()` に渡せるモデルオブジェクト
    - 例: model, pipeline, runtime session, subprocess handle など
    """
    raise NotImplementedError("ここに fine-tuned LFM2.5-Audio モデルの読み込み処理を書く")


def run_audio_transcription(audio_model: Any, audio_path: Path, content_type: str) -> str:
    """音声ファイルを文字起こしする関数です。

    ここに書くこと:
    - SAFi から届いた音声ファイル `audio_path` を受け取る
    - 必要なら wav など、モデルが読める形式に変換する
    - `audio_model` に音声を渡して日本語文字起こしを実行する
    - 文字起こしされたテキストだけを `str` で返す

    注意:
    - ブラウザからは `audio/webm` が来ることが多いです
    - ランタイムが wav しか受け付けない場合は、ここで変換してください
    - 返り値は必ず文字列にしてください

    返り値例:
    - "警察です。捜査なので誰にも言わないでください。"
    """
    raise NotImplementedError("ここに LFM2.5-Audio の文字起こし推論処理を書く")


def load_detector_model(model_path: Path) -> Any:
    """LFM2.5 の詐欺判定モデルを読み込む関数です。

    ここに書くこと:
    - `model_path` に置いた fine-tuned LFM2.5 モデルを読み込む
    - tokenizer / model / pipeline / runtime session などを初期化する
    - `run_detector_generation()` に渡せる形で返す

    良い最終挙動:
    - サーバー起動時に1回だけ読み込む
    - 推論のたびにロードし直さない
    - temperature は 0 またはそれに近い決定的設定にする
    - 出力はSAFiが期待する5つのシグナルJSONに寄せる
    """
    raise NotImplementedError("ここに fine-tuned LFM2.5 詐欺判定モデルの読み込み処理を書く")


def run_detector_generation(detector_model: Any, messages: list[dict[str, str]]) -> dict[str, Any]:
    """LFM2.5 で特殊詐欺シグナルJSONを生成する関数です。

    ここに書くこと:
    - SAFi から届いた `messages` をプロンプトに変換する
    - `detector_model` にプロンプトを渡して推論する
    - モデル出力からJSON部分を取り出す
    - `normalize_analysis()` に通せる dict を返す

    返すべきJSONのキー:
    - is_authority
    - has_threat
    - has_secrecy
    - ask_financial
    - demand_action

    それぞれの値:
    - {"status": true/false, "text": "根拠になった発話"}
    """
    prompt = build_detector_prompt(messages)

    # ここを実モデル推論に置き換えてください。
    #
    # 実装イメージ:
    #
    # raw_output = detector_model.generate(prompt, temperature=0)
    # analysis = parse_analysis_json(raw_output)
    # return analysis
    #
    # 重要:
    # - デモを安定させるため temperature は 0 推奨です
    # - LLMが余計な文章を返す場合は `parse_analysis_json()` でJSONだけ抽出してください
    # - JSONが壊れている場合は `empty_analysis()` に落としても構いません
    raise NotImplementedError(f"ここに LFM2.5 の詐欺判定推論処理を書く。Prompt: {prompt[:120]}")


audio_model = load_audio_model(AUDIO_MODEL_PATH)
detector_model = load_detector_model(DETECTOR_MODEL_PATH)


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "ok": True,
        "service": "SAFi local LFM inference",
        "audio_model": str(AUDIO_MODEL_PATH),
        "detector_model": str(DETECTOR_MODEL_PATH),
    }


@app.post("/transcribe")
async def transcribe(request: Request) -> dict[str, Any]:
    audio_bytes = await request.body()
    content_type = request.headers.get("content-type", "audio/webm")

    suffix = extension_for_content_type(content_type)
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=True) as audio_file:
        audio_file.write(audio_bytes)
        audio_file.flush()
        text = run_audio_transcription(audio_model, Path(audio_file.name), content_type)

    return {
        "model": request.headers.get("x-safi-model", str(AUDIO_MODEL_PATH)),
        "text": text,
    }


@app.post("/v1/chat/completions")
async def chat_completions(request: Request) -> dict[str, Any]:
    body = await request.json()
    messages = body.get("messages", [])
    analysis = normalize_analysis(run_detector_generation(detector_model, messages))

    return {
        "id": "safi-local-lfm",
        "object": "chat.completion",
        "model": body.get("model", str(DETECTOR_MODEL_PATH)),
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": json.dumps(analysis, ensure_ascii=False),
                },
                "finish_reason": "stop",
            }
        ],
    }


def build_detector_prompt(messages: list[dict[str, str]]) -> str:
    """SAFiから届いたchat messagesを、LFM2.5へ渡す1本のプロンプトに変換します。

    基本的にはこのまま使えます。
    ファインチューニング時のプロンプト形式が決まっている場合は、ここを合わせてください。
    """
    user_text = ""
    for message in messages:
        if message.get("role") == "user":
            user_text = str(message.get("content", ""))

    return f"{SYSTEM_PROMPT}\n\n入力発話:\n{user_text}\n\nJSON:"


def parse_analysis_json(raw_output: str) -> dict[str, Any]:
    """モデル出力から最初のJSONオブジェクトだけを取り出してparseします。

    LLMが前後に説明文を付けてしまった場合の保険です。
    モデルが必ずJSONだけを返すなら、そのまま `json.loads()` に変えても構いません。
    """
    text = raw_output.strip()
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end < start:
        return empty_analysis()

    try:
        return json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return empty_analysis()


def normalize_analysis(analysis: dict[str, Any]) -> dict[str, Any]:
    """SAFiが期待する5シグナルの形に正規化します。

    足りないキーは `status: false` で補完します。
    `text` は長すぎるとUIが崩れるため180文字で切ります。
    """
    normalized = empty_analysis()
    for key in SIGNAL_KEYS:
        item = analysis.get(key) if isinstance(analysis, dict) else None
        normalized[key] = {
            "status": bool(item.get("status")) if isinstance(item, dict) else False,
            "text": str(item.get("text", ""))[:180] if isinstance(item, dict) and item.get("status") else "",
        }
    return normalized


def empty_analysis() -> dict[str, Any]:
    """何も検知しなかった場合の空JSONを返します。"""
    return {key: {"status": False, "text": ""} for key in SIGNAL_KEYS}


def extension_for_content_type(content_type: str) -> str:
    """Content-Typeから一時ファイルの拡張子を決めます。

    音声ランタイムが拡張子で形式を判断する場合があるため、ここで最低限合わせます。
    """
    if "mp4" in content_type:
        return ".mp4"
    if "mpeg" in content_type or "mp3" in content_type:
        return ".mp3"
    if "wav" in content_type:
        return ".wav"
    if "ogg" in content_type:
        return ".ogg"
    return ".webm"
