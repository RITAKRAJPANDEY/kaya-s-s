"""Mock Speech-to-Text Provider for testing and local development without API keys."""

import asyncio
from app.interfaces import STTProvider


class MockSTTProvider(STTProvider):
    """Mock STT returning simulated speech transcripts."""

    def __init__(self, default_transcript: str = "What am I looking at?"):
        self.default_transcript = default_transcript

    @property
    def name(self) -> str:
        return "mock/stt"

    async def transcribe(self, audio_bytes: bytes, mime_type: str = "audio/wav") -> str:
        # Simulate slight processing delay
        await asyncio.sleep(0.15)
        return self.default_transcript
