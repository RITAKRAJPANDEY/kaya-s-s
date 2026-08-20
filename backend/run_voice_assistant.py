#!/usr/bin/env python3
"""Run the Kaya Voice + Vision Multimodal Assistant Web Application."""

import uvicorn
from app.config import get_settings

def main():
    settings = get_settings()
    print("=" * 60)
    print("🚀 Starting Kaya Voice + Vision Assistant...")
    print(f"📍 Web UI:         http://{settings.host}:{settings.port}")
    print(f"👁️  Vision Provider: {settings.vision_provider}")
    print(f"🎙️  STT Provider:    {settings.stt_provider}")
    print(f"🔊 TTS Provider:    {settings.tts_provider}")
    print(f"🎞️  Frame Mode:      {settings.frame_mode} (Buffer: {settings.temporal_buffer_seconds}s @ {settings.temporal_fps} FPS)")
    print("=" * 60)

    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=True
    )

if __name__ == "__main__":
    main()
