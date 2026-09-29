"""Hindsight-backed knowledge retriever: static SOP knowledge + live site memory.

Wraps a single Hindsight bank that accumulates three kinds of content over the
life of a deployment: ingested SOP/manual text (static "world" knowledge),
every voice/text Q&A turn the assistant handles, and every hazard the vision
pipeline detects. A "Site Safety Playbook" mental model auto-refreshes as new
hazards/turns come in, synthesizing recurring patterns by zone and type.
"""

import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from hindsight_client import Hindsight

from app.interfaces import KnowledgeRetriever, RetrievedChunk

logger = logging.getLogger("kaya.providers.rag.hindsight")

BANK_NAME = "Kaya Safety Copilot Memory"
MISSION = (
    "You are Kaya, the institutional safety memory of a construction job site. You remember every "
    "hazard event, every voice query a worker has asked, every PPE violation, every near-miss, and "
    "every OSHA/SOP rule. You reason like a careful site safety officer: cite specific past incidents "
    "when they exist, prefer the most recent policy or zone status when precedents conflict, and never "
    "understate a genuine hazard."
)
RETAIN_MISSION = (
    "Extract: hazard type (fall, PPE violation, zone proximity, vehicle proximity, blind-spot alert), "
    "severity, zone/location name, worker identifier if known, distance in meters, whether it was "
    "acknowledged or escalated, and the exact voice question asked and answer given if this is a "
    "conversational turn."
)
PLAYBOOK_ID = "site-safety-playbook"
DEFAULT_DISPOSITION = {"skepticism": 3, "literalism": 4, "empathy": 2}


class HindsightKnowledgeRetriever(KnowledgeRetriever):
    """Knowledge retriever backed by Hindsight: SOP text + live site memory, in one bank."""

    FAILURE_THRESHOLD = 3
    COOLDOWN_S = 60

    def __init__(self, hindsight_url: str, hindsight_api_key: str, bank_id: str,
                 default_top_k: int = 4):
        self.bank_id = bank_id
        self.default_top_k = default_top_k
        self._client = Hindsight(base_url=hindsight_url, api_key=hindsight_api_key or None,
                                  timeout=60.0)
        self._failures = 0
        self._open_until = 0.0
        self._bank_ready = False

    @property
    def name(self) -> str:
        return "hindsight_retriever"

    # --- circuit breaker (async path) ---
    async def _call(self, coro_fn, *args, **kwargs):
        if time.monotonic() < self._open_until:
            raise RuntimeError("Hindsight circuit open (too many recent failures, cooling down)")
        try:
            result = await coro_fn(*args, **kwargs)
        except Exception as e:
            self._failures += 1
            logger.warning("Hindsight call failed (%d/%d): %s", self._failures,
                           self.FAILURE_THRESHOLD, e)
            if self._failures >= self.FAILURE_THRESHOLD:
                self._open_until = time.monotonic() + self.COOLDOWN_S
            raise
        self._failures = 0
        return result

    # --- circuit breaker (sync path, called from the CV worker thread) ---
    def _call_sync(self, fn, *args, **kwargs):
        if time.monotonic() < self._open_until:
            raise RuntimeError("Hindsight circuit open (too many recent failures, cooling down)")
        try:
            result = fn(*args, **kwargs)
        except Exception as e:
            self._failures += 1
            logger.warning("Hindsight call failed (%d/%d): %s", self._failures,
                           self.FAILURE_THRESHOLD, e)
            if self._failures >= self.FAILURE_THRESHOLD:
                self._open_until = time.monotonic() + self.COOLDOWN_S
            raise
        self._failures = 0
        return result

    # --- one-time bank setup: idempotent, safe to call repeatedly ---
    async def ensure_bank(self) -> None:
        if self._bank_ready:
            return
        try:
            await self._client.acreate_bank(
                bank_id=self.bank_id, name=BANK_NAME, mission=MISSION, reflect_mission=MISSION,
                retain_mission=RETAIN_MISSION, disposition=DEFAULT_DISPOSITION,
                enable_observations=True,
            )
        except Exception as e:  # already exists on re-run
            logger.info("bank create: %s", e)
        try:
            await self._client.acreate_mental_model(
                bank_id=self.bank_id, id=PLAYBOOK_ID, name="Site Safety Playbook",
                source_query=(
                    "What are the recurring hazard patterns on this site? Group by zone and hazard "
                    "type. For each, note frequency, typical severity, and whether workers usually "
                    "acknowledge or ignore the alert."
                ),
                max_tokens=1500,
                trigger={"refresh_after_consolidation": True, "mode": "delta",
                        "min_refresh_interval_seconds": 120},
            )
        except Exception as e:  # already exists on re-run
            logger.info("mental model setup: %s", e)
        self._bank_ready = True

    def ensure_bank_sync(self) -> None:
        """Sync counterpart of ``ensure_bank`` for the CV worker thread. Idempotent."""
        if self._bank_ready:
            return
        try:
            self._client.create_bank(
                bank_id=self.bank_id, name=BANK_NAME, mission=MISSION, reflect_mission=MISSION,
                retain_mission=RETAIN_MISSION, disposition=DEFAULT_DISPOSITION,
                enable_observations=True,
            )
        except Exception as e:
            logger.info("bank create: %s", e)
        try:
            self._client.create_mental_model(
                bank_id=self.bank_id, id=PLAYBOOK_ID, name="Site Safety Playbook",
                source_query=(
                    "What are the recurring hazard patterns on this site? Group by zone and hazard "
                    "type. For each, note frequency, typical severity, and whether workers usually "
                    "acknowledge or ignore the alert."
                ),
                max_tokens=1500,
                trigger={"refresh_after_consolidation": True, "mode": "delta",
                        "min_refresh_interval_seconds": 120},
            )
        except Exception as e:
            logger.info("mental model setup: %s", e)
        self._bank_ready = True

    async def is_ready(self) -> bool:
        try:
            await self.ensure_bank()
            return True
        except Exception as e:
            logger.warning("Hindsight bank not reachable: %s", e)
            return False

    async def get_store_info(self) -> Dict[str, Any]:
        ready = await self.is_ready()
        return {
            "provider": self.name,
            "ready": ready,
            "bank_id": self.bank_id,
            "document_count": None,  # Hindsight doesn't expose a flat doc count the same way
            "message": "Hindsight live memory bank" if ready else "Hindsight unreachable",
        }

    def get_file_search_store_name(self) -> Optional[str]:
        return None  # not applicable to Hindsight

    @staticmethod
    def _chunk_from_result(r: Any) -> RetrievedChunk:
        occurred = getattr(r, "occurred_start", None) or getattr(r, "mentioned_at", None)
        return RetrievedChunk(
            text=r.text,
            document_name=getattr(r, "document_id", None) or "site-memory",
            page_number=None,
            section_title=f"{r.type} · {occurred}" if occurred else r.type,
            score=getattr(r, "score", 0.0) or 0.0,
            metadata=getattr(r, "metadata", None) or {},
        )

    async def retrieve(self, query: str, top_k: Optional[int] = None) -> List[RetrievedChunk]:
        """Recall relevant memories (SOP facts + live site history) as RetrievedChunks."""
        if not query or not query.strip():
            return []
        k = top_k or self.default_top_k
        try:
            await self.ensure_bank()
            resp = await self._call(
                self._client.arecall, bank_id=self.bank_id, query=query,
                types=["world", "experience", "observation"], budget="mid", max_tokens=2000,
            )
        except Exception as e:
            logger.warning("[HindsightKnowledgeRetriever] recall failed: %s", e)
            return []

        chunks = [self._chunk_from_result(r) for r in (resp.results or [])[:k]]
        logger.info("[HindsightKnowledgeRetriever] recalled %d memories for: %.50s", len(chunks), query)
        return chunks

    # --- the new capability Docling doesn't have: writing memory back ---
    async def retain_turn(self, question: str, answer: str, worker_id: str = "unknown",
                          zone: Optional[str] = None) -> None:
        """Retain a completed voice/text Q&A turn as an experience memory. Fire-and-forget."""
        try:
            await self.ensure_bank()
            text = f'Worker asked: "{question}"\nKaya answered: "{answer}"'
            tags = ["interaction", f"worker:{worker_id}"]
            if zone:
                tags.append(f"zone:{zone.lower().replace(' ', '_')}")
            await self._call(
                self._client.aretain, bank_id=self.bank_id, content=text, tags=tags,
                context="Voice/vision assistant interaction",
                timestamp=datetime.now(timezone.utc),
                document_id=f"turn-{int(time.time() * 1000)}",
            )
        except Exception as e:  # never let a memory-write failure break the actual answer
            logger.warning("[HindsightKnowledgeRetriever] retain_turn failed (non-fatal): %s", e)

    @staticmethod
    def _hazard_content(hazard_type: str, severity: str, zone: Optional[str], description: str,
                        distance_meters: Optional[float], source: str) -> tuple[str, list[str]]:
        text = (f"Hazard event: {hazard_type} (severity: {severity}) "
               f"in zone '{zone or 'unspecified'}'. {description}"
               + (f" Distance: {distance_meters:.1f}m." if distance_meters is not None else "")
               + f" Source: {source}.")
        tags = ["hazard", f"type:{hazard_type}", f"severity:{severity}"]
        if zone:
            tags.append(f"zone:{zone.lower().replace(' ', '_')}")
        return text, tags

    async def retain_hazard(self, hazard_type: str, severity: str, zone: Optional[str],
                            description: str, distance_meters: Optional[float] = None,
                            source: str = "local") -> None:
        """Retain a hazard/alert event as an experience memory (async — FastAPI routes only)."""
        try:
            await self.ensure_bank()
            text, tags = self._hazard_content(hazard_type, severity, zone, description,
                                              distance_meters, source)
            await self._call(
                self._client.aretain, bank_id=self.bank_id, content=text, tags=tags,
                context="Hazard/alert event", timestamp=datetime.now(timezone.utc),
                document_id=f"hazard-{int(time.time() * 1000)}",
            )
        except Exception as e:
            logger.warning("[HindsightKnowledgeRetriever] retain_hazard failed (non-fatal): %s", e)

    def retain_hazard_sync(self, hazard_type: str, severity: str, zone: Optional[str],
                           description: str, distance_meters: Optional[float] = None,
                           source: str = "local_cv") -> None:
        """Retain a hazard as an experience memory (sync — safe to call from the CV worker thread).

        Intended to be submitted to a ThreadPoolExecutor by the caller so it never blocks
        frame processing; this method itself makes a blocking HTTP call.
        """
        try:
            self.ensure_bank_sync()
            text, tags = self._hazard_content(hazard_type, severity, zone, description,
                                              distance_meters, source)
            self._call_sync(
                self._client.retain, bank_id=self.bank_id, content=text, tags=tags,
                context="Hazard/alert event", timestamp=datetime.now(timezone.utc),
                document_id=f"hazard-{int(time.time() * 1000)}",
            )
        except Exception as e:
            logger.warning("[HindsightKnowledgeRetriever] retain_hazard_sync failed (non-fatal): %s", e)

    async def get_playbook(self) -> Dict[str, Any]:
        """Fetch the auto-refreshing Site Safety Playbook mental model (for the demo endpoint)."""
        await self.ensure_bank()
        mm = await self._client.aget_mental_model(bank_id=self.bank_id,
                                                   mental_model_id=PLAYBOOK_ID, detail="content")
        return {"id": PLAYBOOK_ID, "name": "Site Safety Playbook",
               "content": getattr(mm, "content", None) or getattr(mm, "text", str(mm))}
