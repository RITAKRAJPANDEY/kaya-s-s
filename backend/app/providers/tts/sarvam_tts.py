"""Sarvam AI Text-to-Speech (Bulbul) Provider with macOS Native Failover."""

import base64
import logging
from typing import Optional
import httpx

from app.interfaces import TTSProvider
from app.providers.tts.mac_tts import MacNativeTTSProvider

logger = logging.getLogger("kaya.tts.sarvam")


import re


class SarvamTTSProvider(TTSProvider):
    """TTS Provider using Sarvam AI Bulbul API with automatic local failover."""

    def __init__(
        self,
        api_key: str,
        model: str = "bulbul:v3",
        speaker: str = "shubh",
        language_code: str = "en-IN",
        pace: float = 1.4,
    ):
        if not api_key:
            raise ValueError("Sarvam API key is required for SarvamTTSProvider.")
        self.api_key = api_key
        self.model = model
        self.speaker = speaker
        self.language_code = language_code
        self.pace = pace
        self.api_url = "https://api.sarvam.ai/text-to-speech"
        self.mac_fallback = MacNativeTTSProvider()

    @property
    def name(self) -> str:
        return f"sarvam/{self.model}/{self.speaker}"

    def _prepare_spoken_text(self, text: str) -> str:
        """Strip markdown syntax and format text for natural, intelligible TTS output."""
        if not text:
            return ""
        # Remove bold, italics, headers, code, and bullet symbols
        clean = re.sub(r"[\*#_`~>]", "", text)
        # Convert markdown links [text](url) -> text
        clean = re.sub(r"\[(.*?)\]\(.*?\)", r"\1", clean)
        # Replace multiple whitespace and newlines with a single space
        clean = re.sub(r"\s+", " ", clean).strip()
        # Cap to 480 characters for Sarvam API limit
        if len(clean) > 480:
            # Try to trim at last sentence period
            last_period = clean[:477].rfind(".")
            if last_period > 200:
                clean = clean[:last_period + 1]
            else:
                clean = clean[:477] + "..."
        return clean

    async def synthesize(self, text: str) -> bytes:
        """Synthesize text into WAV audio bytes, with automatic failover."""
        clean_text = self._prepare_spoken_text(text)
        if not clean_text:
            return b""

        payload = {
            "inputs": [clean_text],
            "target_language_code": self.language_code,
            "speaker": self.speaker,
            "model": self.model,
            "pace": self.pace,
            "enable_preprocessing": True
        }


        headers = {
            "api-subscription-key": self.api_key,
            "Content-Type": "application/json"
        }

        # Generous timeout (15s read, 5s connect) to prevent premature fallback
        custom_timeout = httpx.Timeout(connect=5.0, read=15.0, write=5.0, pool=5.0)
        try:
            async with httpx.AsyncClient(timeout=custom_timeout) as client:
                response = await client.post(
                    self.api_url,
                    headers=headers,
                    json=payload
                )

            if response.status_code == 200:
                result = response.json()
                audios = result.get("audios", [])
                if audios and audios[0]:
                    return base64.b64decode(audios[0])
            else:
                logger.warning(f"Sarvam TTS error (status {response.status_code}): {response.text}")

        except (httpx.ConnectTimeout, httpx.ConnectError, httpx.TimeoutException) as net_err:
            logger.warning(f"Sarvam TTS network timeout: {net_err}. Using macOS native speech failover...")
            return await self.mac_fallback.synthesize(clean_text)
        except Exception as e:
            logger.warning(f"Sarvam TTS error: {e}. Using macOS native speech failover...")
            return await self.mac_fallback.synthesize(clean_text)

        # Fallback if Sarvam returned non-200 or empty audio
        return await self.mac_fallback.synthesize(clean_text)

