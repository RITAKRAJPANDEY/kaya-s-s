"""Mock Text-to-Speech Provider generating synthetic WAV audio for testing."""

import asyncio
import io
import math
import struct
import wave
from app.interfaces import TTSProvider


class MockTTSProvider(TTSProvider):
    """Mock TTS producing a short synthetic tone WAV."""

    def __init__(self, tone_hz: float = 440.0, duration_sec: float = 0.5):
        self.tone_hz = tone_hz
        self.duration_sec = duration_sec

    @property
    def name(self) -> str:
        return "mock/tts"

    async def synthesize(self, text: str) -> bytes:
        await asyncio.sleep(0.1)

        # Generate a simple 16-bit PCM WAV audio clip
        sample_rate = 22050
        num_samples = int(sample_rate * self.duration_sec)
        buf = io.BytesIO()

        with wave.open(buf, "wb") as wav_file:
            wav_file.setnchannels(1)
            wav_file.setsampwidth(2)
            wav_file.setframerate(sample_rate)

            # Generate envelope-decayed sine wave
            raw_frames = bytearray()
            for i in range(num_samples):
                t = float(i) / sample_rate
                # Exponential decay envelope
                envelope = math.exp(-3.0 * t / self.duration_sec)
                val = int(32767.0 * 0.4 * envelope * math.sin(2.0 * math.pi * self.tone_hz * t))
                raw_frames.extend(struct.pack("<h", val))

            wav_file.writeframes(raw_frames)

        return buf.getvalue()
