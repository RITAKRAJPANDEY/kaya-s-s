"""Tests for FastAPI endpoints."""

import io
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from app.main import app, pipeline
from app.config import Settings
from app.providers.stt.mock_stt import MockSTTProvider
from app.providers.vision.mock_vision import MockVisionReasoner
from app.providers.tts.mock_tts import MockTTSProvider

client = TestClient(app)


@pytest.fixture(autouse=True)
def setup_mock_pipeline():
    """Ensure tests run deterministically using mock providers without network dependency."""
    orig_stt = pipeline.stt_provider
    orig_vision = pipeline.vision_reasoner
    orig_tts = pipeline.tts_provider

    pipeline.stt_provider = MockSTTProvider(default_transcript="What is in the scene?")
    pipeline.vision_reasoner = MockVisionReasoner()
    pipeline.tts_provider = MockTTSProvider()

    yield

    pipeline.stt_provider = orig_stt
    pipeline.vision_reasoner = orig_vision
    pipeline.tts_provider = orig_tts


def get_dummy_image_file():
    img = Image.new("RGB", (100, 100), color="blue")
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    buf.seek(0)
    return ("frame.jpg", buf.getvalue(), "image/jpeg")


def get_dummy_wav_audio():
    import struct, wave
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(16000)
        raw_frames = bytearray()
        for i in range(8000):
            val = int(32767 * 0.3 * (1 if i % 2 == 0 else -1))
            raw_frames.extend(struct.pack("<h", val))
        wav_file.writeframes(raw_frames)
    return buf.getvalue()


def test_status_endpoint():
    response = client.get("/api/status")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ready"
    assert "providers" in data
    assert "config" in data
    assert "frame_mode" in data["config"]
    assert "temporal_buffer_seconds" in data["config"]


def test_reset_endpoint():
    response = client.post("/api/reset")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"


def test_ask_text_endpoint_single_frame():
    filename, content, mime = get_dummy_image_file()
    response = client.post(
        "/api/ask-text",
        data={"question": "Describe the scene.", "frame_mode": "SINGLE_FRAME"},
        files={"image": (filename, content, mime)}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["transcript"] == "Describe the scene."
    assert "response" in data
    assert "timings" in data
    assert data.get("frame_mode") == "SINGLE_FRAME"
    assert data.get("frame_count") == 1


def test_ask_text_endpoint_temporal_frames():
    _, content1, mime = get_dummy_image_file()
    _, content2, _ = get_dummy_image_file()
    response = client.post(
        "/api/ask-text",
        data={"question": "What is happening across these frames?", "frame_mode": "TEMPORAL_FRAMES"},
        files=[
            ("images", ("f1.jpg", content1, mime)),
            ("images", ("f2.jpg", content2, mime)),
        ]
    )
    assert response.status_code == 200
    data = response.json()
    assert "response" in data
    assert data.get("frame_mode") == "TEMPORAL_FRAMES"
    assert data.get("frame_count") == 2


def test_ask_voice_endpoint():
    filename, content, mime = get_dummy_image_file()
    valid_audio = get_dummy_wav_audio()
    response = client.post(
        "/api/ask",
        data={"frame_mode": "SINGLE_FRAME"},
        files={
            "audio": ("voice.wav", valid_audio, "audio/wav"),
            "image": (filename, content, mime)
        }
    )
    assert response.status_code == 200

    data = response.json()
    assert "transcript" in data
    assert "response" in data
    assert "timings" in data
