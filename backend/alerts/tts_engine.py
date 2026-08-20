"""macOS `say` TTS wrapper for real-time safety alerts.

Uses the native macOS `say` command for zero-dependency text-to-speech.
Speech rate scales with alert severity so critical warnings are unmissable.
"""

from __future__ import annotations

import logging
import subprocess
import time
from typing import Optional

from core.models import Severity

logger = logging.getLogger(__name__)


class TTSEngine:
    """Non-blocking text-to-speech via macOS `say` command.

    Features
    --------
    - Rate scales with severity (calm → critical).
    - Cooldown prevents repeating the same message within a window.
    - CRITICAL severity interrupts any in-progress speech.
    - Concurrency cap kills the oldest process when exceeded.
    """

    # ── Severity → speech-rate profile name ─────────────────
    _SEVERITY_PROFILE = {
        Severity.INFO: "calm",
        Severity.WARNING: "normal",
        Severity.DANGER: "urgent",
        Severity.CRITICAL: "critical",
    }

    def __init__(
        self,
        voice: str = "Samantha",
        rates: Optional[dict[str, int]] = None,
        max_concurrent: int = 1,
        cooldown_seconds: float = 5.0,
    ) -> None:
        self.voice = voice
        self.rates: dict[str, int] = rates or {
            "calm": 160,
            "normal": 180,
            "urgent": 220,
            "critical": 240,
        }
        self.max_concurrent = max_concurrent
        self.cooldown_seconds = cooldown_seconds

        self._active_processes: list[subprocess.Popen] = []
        self._last_spoken: dict[str, float] = {}  # text → last-spoken timestamp

    # ── Public API ──────────────────────────────────────────

    def speak(self, text: str, severity: Severity) -> None:
        """Speak *text* at a rate matching *severity* (non-blocking).

        Parameters
        ----------
        text:
            Message to be spoken aloud.
        severity:
            Determines speech rate and interrupt behaviour.
        """
        now = time.time()

        # Cooldown — skip if this exact message was spoken recently.
        if text in self._last_spoken:
            elapsed = now - self._last_spoken[text]
            if elapsed < self.cooldown_seconds:
                logger.debug(
                    "TTS cooldown: skipping '%s' (%.1fs since last)", text, elapsed
                )
                return

        # CRITICAL interrupts everything currently playing.
        if severity == Severity.CRITICAL:
            self.stop()

        # Housekeep finished processes before checking concurrency.
        self.cleanup()

        # Enforce concurrency cap — kill oldest if we're at the limit.
        while len(self._active_processes) >= self.max_concurrent:
            oldest = self._active_processes.pop(0)
            try:
                oldest.kill()
                oldest.wait(timeout=1)
            except Exception:
                pass
            logger.debug("TTS: killed oldest process to stay within concurrency cap")

        # Resolve speech rate from severity.
        profile = self._SEVERITY_PROFILE.get(severity, "normal")
        rate = self.rates.get(profile, 180)

        # Launch `say` asynchronously.
        try:
            proc = subprocess.Popen(
                ["say", "-v", self.voice, "-r", str(rate), text],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            self._active_processes.append(proc)
            self._last_spoken[text] = now
            logger.info("TTS [%s/%d wpm]: %s", severity.value, rate, text)
        except FileNotFoundError:
            logger.warning("TTS unavailable — `say` command not found (non-macOS?)")
        except Exception as exc:
            logger.error("TTS launch failed: %s", exc)

    def stop(self) -> None:
        """Kill **all** active TTS processes immediately."""
        for proc in self._active_processes:
            try:
                proc.kill()
                proc.wait(timeout=1)
            except Exception:
                pass
        self._active_processes.clear()
        logger.debug("TTS: all processes stopped")

    def cleanup(self) -> None:
        """Remove finished processes from the active list."""
        self._active_processes = [
            p for p in self._active_processes if p.poll() is None
        ]
