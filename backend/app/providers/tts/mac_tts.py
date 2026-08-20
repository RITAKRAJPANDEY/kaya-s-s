"""macOS Native Text-to-Speech Provider using built-in high quality speech engine."""

import asyncio
import logging
import os
import shutil
import tempfile
from typing import Optional
from app.interfaces import TTSProvider

logger = logging.getLogger("kaya.tts.mac")


class MacNativeTTSProvider(TTSProvider):
    """High-performance on-device TTS using macOS built-in speech synthesis."""

    def __init__(self, voice: str = "Samantha", rate: int = 215):
        self.voice = voice
        self.rate = rate
        self.say_path = shutil.which("say")

    @property
    def name(self) -> str:
        return f"mac/{self.voice}"

    async def synthesize(self, text: str) -> bytes:
        """Synthesize speech into 22.05kHz 16-bit PCM WAV bytes."""
        if not text or not text.strip():
            return b""

        clean_text = text.strip()
        # Remove any Markdown asterisks or bold tags for clean speech
        clean_text = clean_text.replace("*", "").replace("#", "").replace("`", "")

        if not self.say_path:
            logger.warning("'say' command not found on system. Returning empty audio.")
            return b""

        temp_wav = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        temp_wav_path = temp_wav.name
        temp_wav.close()

        try:
            cmd = [
                self.say_path,
                "-v", self.voice,
                "-r", str(self.rate),
                "--data-format=LEI16@22050",
                "-o", temp_wav_path,
                clean_text
            ]

            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            _, stderr = await process.communicate()

            if process.returncode != 0:
                # If specific voice wasn't found, retry with system default voice
                logger.warning(f"Failed with voice {self.voice}: {stderr.decode()}. Retrying with default voice...")
                fallback_cmd = [
                    self.say_path,
                    "-r", str(self.rate),
                    "--data-format=LEI16@22050",
                    "-o", temp_wav_path,
                    clean_text
                ]

                fallback_proc = await asyncio.create_subprocess_exec(
                    *fallback_cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                await fallback_proc.communicate()

            if os.path.exists(temp_wav_path):
                with open(temp_wav_path, "rb") as f:
                    wav_bytes = f.read()
                return wav_bytes

        except Exception as e:
            logger.error(f"Mac native TTS synthesis error: {e}")
        finally:
            if os.path.exists(temp_wav_path):
                try:
                    os.unlink(temp_wav_path)
                except Exception:
                    pass

        return b""
