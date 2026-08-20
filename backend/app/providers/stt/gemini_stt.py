"""Google Gemini Speech-to-Text Provider (Supports WAV, WebM, MP3)."""

import base64
import logging
from typing import Optional
import httpx

from app.interfaces import STTProvider

logger = logging.getLogger("kaya.stt.gemini")


class GeminiSTTProvider(STTProvider):
    """STT Provider using Google Gemini Multimodal Audio understanding."""

    def __init__(self, api_key: str, model: str = "gemini-3.6-flash"):
        if not api_key:
            raise ValueError("Gemini API key is required for GeminiSTTProvider.")
        self.api_key = api_key
        self.model = model
        self.api_url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent"

    @property
    def name(self) -> str:
        return f"gemini/{self.model}"

    async def transcribe(self, audio_bytes: bytes, mime_type: str = "audio/wav") -> str:
        """Transcribe speech audio using Gemini audio understanding."""
        if not audio_bytes or len(audio_bytes) == 0:
            return ""

        clean_mime = mime_type.split(";")[0].strip()
        if not clean_mime.startswith("audio/"):
            clean_mime = "audio/webm"

        b64_audio = base64.b64encode(audio_bytes).decode("utf-8")

        payload = {
            "contents": [{
                "parts": [
                    {
                        "inline_data": {
                            "mime_type": clean_mime,
                            "data": b64_audio
                        }
                    },
                    {
                        "text": "Transcribe the spoken speech in this audio exactly. Return only the transcription without any commentary."
                    }
                ]
            }],
            "generationConfig": {
                "temperature": 0.0,
                "maxOutputTokens": 200
            }
        }

        headers = {
            "x-goog-api-key": self.api_key,
            "Content-Type": "application/json"
        }

        custom_timeout = httpx.Timeout(connect=15.0, read=45.0, write=30.0, pool=10.0)
        async with httpx.AsyncClient(timeout=custom_timeout) as client:
            response = await client.post(
                self.api_url,
                headers=headers,
                json=payload
            )


        if response.status_code != 200:
            raise RuntimeError(f"Gemini STT API error (status {response.status_code}): {response.text}")

        data = response.json()
        try:
            candidates = data.get("candidates", [])
            if not candidates:
                return ""
            parts = candidates[0].get("content", {}).get("parts", [])
            transcript = "".join(p.get("text", "") for p in parts).strip()
            return transcript
        except Exception as e:
            logger.error(f"Failed to parse Gemini STT response: {e}")
            return ""
