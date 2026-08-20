"""Tests for provider interfaces, configurations, and factories."""

import pytest
from app.config import Settings
from app.factory import get_stt_provider, get_vision_reasoner, get_tts_provider
from app.providers.stt.mock_stt import MockSTTProvider
from app.providers.stt.sarvam_stt import SarvamSTTProvider
from app.providers.vision.mock_vision import MockVisionReasoner
from app.providers.vision.gemini_vision import GeminiVisionReasoner
from app.providers.vision.ollama_vision import OllamaVisionReasoner
from app.providers.vision.nvidia_vision import NvidiaVisionReasoner
from app.providers.tts.mock_tts import MockTTSProvider
from app.providers.tts.sarvam_tts import SarvamTTSProvider


def test_mock_providers_instantiation():
    settings = Settings(
        stt_provider="mock",
        vision_provider="mock",
        tts_provider="mock"
    )

    stt = get_stt_provider(settings)
    vision = get_vision_reasoner(settings)
    tts = get_tts_provider(settings)

    assert isinstance(stt, MockSTTProvider)
    assert isinstance(vision, MockVisionReasoner)
    assert isinstance(tts, MockTTSProvider)
    assert stt.name == "mock/stt"
    assert vision.name == "mock"
    assert tts.name == "mock/tts"


def test_sarvam_and_gemini_with_keys():
    settings = Settings(
        gemini_api_key="test_gemini_key_123",
        sarvam_api_key="test_sarvam_key_456",
        vision_provider="gemini",
        stt_provider="sarvam",
        tts_provider="sarvam",
        gemini_model="gemini-2.5-flash",
        sarvam_stt_model="saaras:v3",
        sarvam_tts_model="bulbul:v3"
    )

    stt = get_stt_provider(settings)
    vision = get_vision_reasoner(settings)
    tts = get_tts_provider(settings)

    assert isinstance(stt, SarvamSTTProvider)
    assert isinstance(vision, GeminiVisionReasoner)
    assert isinstance(tts, SarvamTTSProvider)
    assert "saaras:v3" in stt.name
    assert vision.model_name == "gemini-2.5-flash"
    assert "bulbul:v3" in tts.name


def test_ollama_provider_instantiation():
    settings = Settings(
        vision_provider="ollama",
        ollama_base_url="http://localhost:11434",
        ollama_model="llava"
    )

    vision = get_vision_reasoner(settings)
    assert isinstance(vision, OllamaVisionReasoner)
    assert vision.name == "ollama"
    assert vision.model_name == "llava"


def test_nvidia_provider_instantiation():
    settings = Settings(
        vision_provider="nvidia",
        nvidia_api_key="nvapi-test-key-123",
        nvidia_model="meta/llama-3.2-11b-vision-instruct"
    )

    vision = get_vision_reasoner(settings)
    assert isinstance(vision, NvidiaVisionReasoner)
    assert vision.name == "nvidia"
    assert vision.model_name == "meta/llama-3.2-11b-vision-instruct"


@pytest.mark.asyncio
async def test_mock_vision_single_and_multi_frames():
    mock_vlm = MockVisionReasoner()
    # Single frame
    resp_single = await mock_vlm.answer("What is this?", b"dummy_bytes")
    assert "camera frame clearly" in resp_single

    # Multiple temporal frames
    resp_multi = await mock_vlm.answer(
        "What changed?",
        [(b"frame1", "image/jpeg"), (b"frame2", "image/jpeg"), (b"frame3", "image/jpeg")]
    )
    assert "temporal sequence of 3 frames" in resp_multi
