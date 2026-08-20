"""Configuration settings for Kaya Voice + Vision Assistant."""

from functools import lru_cache
from typing import Literal
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        populate_by_name=True,
        case_sensitive=False
    )

    # Providers
    vision_provider: Literal["gemini", "nvidia", "ollama", "mock"] = "gemini"
    stt_provider: Literal["sarvam", "gemini", "mock"] = "sarvam"
    tts_provider: Literal["sarvam", "mac", "mock"] = "sarvam"
    rag_provider: Literal["docling", "gemini", "gemini_file_search", "mock"] = "docling"


    # RAG & Knowledge Base Settings
    rag_enabled: bool = True
    rag_router_mode: Literal["auto", "always", "never"] = "auto"
    rag_top_k: int = 4
    embedding_model: str = "gemini-embedding-001"
    knowledge_dir: str = "pdfs_for_rag"
    knowledge_manifest_path: str = "knowledge/manifest.json"
    knowledge_vector_store_path: str = "knowledge/vector_store.json"
    gemini_file_search_store_name: str = ""



    # API Keys (Loaded from .env or system environment)
    gemini_api_key: str = ""
    sarvam_api_key: str = ""
    nvidia_api_key: str = ""

    # Gemini Settings
    gemini_model: str = "gemini-3.1-flash-lite"

    # NVIDIA Settings
    nvidia_model: str = "meta/llama-3.2-11b-vision-instruct"
    nvidia_base_url: str = "https://integrate.api.nvidia.com/v1"

    # Sarvam STT Settings
    sarvam_stt_model: str = "saaras:v3"
    sarvam_stt_language_code: str = "en-IN"

    # Sarvam TTS Settings
    sarvam_tts_model: str = "bulbul:v3"
    sarvam_tts_speaker: str = "shubh"
    sarvam_tts_language_code: str = "en-IN"
    sarvam_tts_pace: float = 1.4

    # Ollama Settings
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "llava"

    # Frame Mode & Temporal Buffer Settings
    frame_mode: Literal["SINGLE_FRAME", "TEMPORAL_FRAMES"] = "TEMPORAL_FRAMES"
    temporal_buffer_seconds: float = 6.0
    temporal_fps: float = 1.0
    temporal_max_frames: int = 8

    # Server Settings
    host: str = "0.0.0.0"
    port: int = 8001

    # Max History Turns
    max_history_turns: int = 5


@lru_cache()
def _get_cached_settings() -> Settings:
    return Settings()


def get_settings(**kwargs) -> Settings:
    """Return application settings, supporting override kwargs."""
    if kwargs:
        return Settings(**kwargs)
    return _get_cached_settings()


