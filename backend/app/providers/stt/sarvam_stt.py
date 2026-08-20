"""Sarvam AI Speech-to-Text (Saaras) Provider with Gemini failover fallback."""

import logging
from typing import Optional
import httpx

from app.interfaces import STTProvider

logger = logging.getLogger("kaya.stt.sarvam")


class SarvamSTTProvider(STTProvider):
    """STT Provider using Sarvam AI Saaras API with automatic failover."""

    def __init__(
        self,
        api_key: str,
        model: str = "saaras:v3",
        language_code: str = "en-IN",
        gemini_api_key: Optional[str] = None,
    ):
        if not api_key:
            raise ValueError("Sarvam API key is required for SarvamSTTProvider.")
        self.api_key = api_key
        self.model = model
        self.language_code = language_code
        self.api_url = "https://api.sarvam.ai/speech-to-text"
        self.gemini_api_key = gemini_api_key

    @property
    def name(self) -> str:
        return f"sarvam/{self.model}"

    async def transcribe(self, audio_bytes: bytes, mime_type: str = "audio/wav") -> str:
        """Transcribe audio using Sarvam API, falling back to Gemini if network timeout occurs."""
        if not audio_bytes or len(audio_bytes) == 0:
            return ""

        clean_mime = mime_type.split(";")[0].strip()
        allowed_mimes = [
            "audio/webm", "audio/wav", "audio/mp3", "audio/mpeg", "audio/x-wav",
            "audio/ogg", "audio/opus", "audio/flac", "audio/aac", "audio/m4a"
        ]
        if clean_mime not in allowed_mimes:
            clean_mime = "audio/webm"

        filename = "input.webm" if "webm" in clean_mime else "input.wav"

        headers = {
            "api-subscription-key": self.api_key
        }
        data = {
            "model": self.model,
            "language_code": self.language_code
        }
        files = {
            "file": (filename, audio_bytes, clean_mime)
        }

        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                response = await client.post(
                    self.api_url,
                    headers=headers,
                    data=data,
                    files=files
                )

            if response.status_code == 200:
                result = response.json()
                transcript = result.get("transcript", "").strip()
                return transcript
            else:
                logger.warning(f"Sarvam STT returned status {response.status_code}: {response.text}")

        except (httpx.ConnectTimeout, httpx.ConnectError, httpx.TimeoutException) as net_err:
            logger.warning(f"Sarvam STT connection timed out: {net_err}. Attempting Gemini STT failover...")
            if self.gemini_api_key:
                from app.providers.stt.gemini_stt import GeminiSTTProvider
                gemini_stt = GeminiSTTProvider(api_key=self.gemini_api_key)
                return await gemini_stt.transcribe(audio_bytes, clean_mime)
            raise RuntimeError(f"Sarvam STT connection timed out: {net_err}")

        except Exception as e:
            logger.error(f"Sarvam STT error: {e}")
            if self.gemini_api_key:
                from app.providers.stt.gemini_stt import GeminiSTTProvider
                gemini_stt = GeminiSTTProvider(api_key=self.gemini_api_key)
                return await gemini_stt.transcribe(audio_bytes, clean_mime)
            raise

        return ""
