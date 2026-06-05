export const TRANSCRIPTION_MODEL = 'LiquidAI/LFM2.5-Audio-1.5B-JP';
export const DETECTION_MODEL = 'LiquidAI/LFM2.5-8B-A1B';

export const DEFAULT_TRANSCRIPTION_API_URL = `https://api-inference.huggingface.co/models/${TRANSCRIPTION_MODEL}`;
export const DEFAULT_DETECTION_API_URL = 'https://router.huggingface.co/v1/chat/completions';
