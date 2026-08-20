"""Tests for Kaya pipeline orchestration and latency measurement."""

import io
import pytest
from PIL import Image
from app.config import Settings
from app.pipeline import KayaPipeline
from app.providers.stt.mock_stt import MockSTTProvider
from app.providers.vision.mock_vision import MockVisionReasoner
from app.providers.tts.mock_tts import MockTTSProvider


def generate_test_image_bytes() -> bytes:
    """Generate simple JPEG image in memory for testing."""
    img = Image.new("RGB", (320, 240), color=(50, 100, 150))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


@pytest.mark.asyncio
async def test_pipeline_turn_execution():
    settings = Settings(
        stt_provider="mock",
        vision_provider="mock",
        tts_provider="mock",
        frame_mode="TEMPORAL_FRAMES",
        temporal_buffer_seconds=6.0,
        temporal_fps=1.0,
        temporal_max_frames=8,
        max_history_turns=3
    )
    pipeline = KayaPipeline(
        settings=settings,
        stt_provider=MockSTTProvider(default_transcript="What color is the object in front of me?"),
        vision_reasoner=MockVisionReasoner(),
        tts_provider=MockTTSProvider()
    )

    image_bytes = generate_test_image_bytes()
    fake_audio = b"RIFF...."

    # Single frame execution
    result = await pipeline.process_turn(
        audio_bytes=fake_audio,
        images=[(image_bytes, "image/jpeg")],
        frame_mode="SINGLE_FRAME"
    )

    assert result["transcript"] == "What color is the object in front of me?"
    assert result["frame_mode"] == "SINGLE_FRAME"
    assert result["frame_count"] == 1
    assert len(result["audio_base64"]) > 0
    assert "timings" in result
    assert result["timings"]["stt_ms"] >= 0
    assert result["timings"]["vision_ms"] >= 0
    assert result["timings"]["tts_ms"] >= 0
    assert result["timings"]["total_ms"] >= 0
    assert "formatted" in result["timings"]

    # Temporal frames execution (e.g. 4 frames)
    frames = [(image_bytes, "image/jpeg") for _ in range(4)]
    result_temporal = await pipeline.process_turn(
        direct_question="What motion is visible across frames?",
        images=frames,
        frame_mode="TEMPORAL_FRAMES"
    )
    assert result_temporal["frame_mode"] == "TEMPORAL_FRAMES"
    assert result_temporal["frame_count"] == 4
    assert "temporal sequence of 4 frames" in result_temporal["response"]

    # Reset history
    pipeline.reset_history()
    assert len(pipeline.get_history()) == 0
