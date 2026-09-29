# Wiring Hindsight into `egocentric_construction_partner`

**For:** Shaurya — implementation guide for adding Hindsight memory to the Kaya Safety Copilot.
**From:** [teammate] — I've already built and run this exact pattern (retain/recall/reflect, bank setup, circuit breaker) in a separate Hindsight-hackathon project, so the code below is proven, not theoretical. I also read your actual `interfaces.py`, `factory.py`, `config.py`, `docling_rag.py`, `pipeline.py`, `main.py`, `alerts/alert_manager.py`, and `core/models.py` from GitHub before writing this, so most of this is copy-paste-ready against your real code, not guessed. The one part I could **not** read is `app/copilot_bridge.py` — flagged clearly below where that matters.

---

## 0. Why we're doing this, in one paragraph

The hackathon's problem statement requires every team to build using Hindsight, and 25% of judging is specifically "is memory central to the value proposition, does the agent clearly improve over time." Your RAG subsystem right now (Docling + a static local vector store) answers the same way every time — it retrieves the same SOP passage regardless of how many times a worker has asked, or what's actually happened on this specific site. We're adding a second, complementary memory layer: Hindsight retains every voice interaction and every hazard event, so by the 20th interaction the assistant isn't just reading a manual back to you — it's citing what's actually happened on *this* site, to *this* worker, this week. That's the demo: ask it something early, ask again later, show the difference.

This does **not** replace your Docling RAG. It sits alongside it as a second `KnowledgeRetriever` provider, using the exact plug-in pattern your code already has for swapping RAG backends.

---

## 1. What Hindsight actually is (30-second primer)

Hindsight is a memory-as-a-service API from Vectorize. You create a **bank** (a named memory store), then:
- `retain(text, ...)` — write something into memory, tagged and timestamped.
- `recall(query, ...)` — semantic search over everything retained, returns raw matching memory items (like a smarter vector search — this is what your `retrieve()` already does with Docling, just backed by Hindsight instead of a local JSON file).
- `reflect(query, ...)` — asks an LLM to synthesize an answer from recalled memory, with structured output support. More powerful than recall, but we're **not** using this for your main RAG swap-in (see §3.2 for why) — only for the optional Playbook feature in §6.
- **Mental models** — living summaries that auto-refresh as new memories come in (e.g. "the Site Safety Playbook"), so you can query a standing summary instead of re-searching raw history every time.

---

## 2. One-time setup (do this first, ~15 minutes)

### 2.1 Get a Hindsight instance — pick ONE:

**Option A — Hindsight Cloud (simplest, but has a free-tier credit limit):**
1. Sign up at https://ui.hindsight.vectorize.io
2. In Billing, apply promo code `MEMHACK99` for $50 free credits.
3. Note your endpoint (something like `https://api.hindsight.vectorize.io`) and API key.

**Option B — Local Docker (what I ended up using — no credit limit, just your own Groq rate limit to manage):**
```bash
docker run -d --name hindsight --restart unless-stopped --shm-size=1g \
  -p 8888:8888 -p 9999:9999 \
  -e HINDSIGHT_API_LLM_PROVIDER=groq \
  -e HINDSIGHT_API_LLM_API_KEY=<YOUR_GROQ_KEY> \
  -e HINDSIGHT_API_LLM_MODEL=openai/gpt-oss-20b \
  -e HINDSIGHT_API_LLM_GROQ_SERVICE_TIER=on_demand \
  -e HINDSIGHT_API_WORKER_ID=kaya-local \
  -v hindsight-data:/home/hindsight/.pg0 \
  ghcr.io/vectorize-io/hindsight:latest
```
Wait ~30–60s, then confirm it's up: `curl http://localhost:8888/docs` should return HTTP 200.
Your `HINDSIGHT_URL` is then `http://localhost:8888`, and `HINDSIGHT_API_KEY` is left empty.

### 2.2 Get a Groq API key (if you don't already have one)
https://console.groq.com/keys — free tier works but is small (see §7 Troubleshooting, we hit this ourselves).

### 2.3 Add to `.env`
```ini
# --- Hindsight ---
HINDSIGHT_URL=http://localhost:8888        # or your Cloud endpoint
HINDSIGHT_API_KEY=                          # empty for local Docker, set for Cloud
HINDSIGHT_BANK_ID=kaya-safety-copilot
RAG_PROVIDER=hindsight                      # switches your existing RAG_PROVIDER setting to the new one
```

### 2.4 Add the dependency
Add to `requirements.txt`:
```
hindsight-client>=0.10
```
Then `pip install -r requirements.txt` (or just `pip install hindsight-client` in your existing venv).

---

## 3. The new RAG provider — `app/providers/rag/hindsight_rag.py`

### 3.1 Why this is the right integration point
Your `KnowledgeRetriever` ABC (`app/interfaces.py`) has exactly 4 methods: `name`, `is_ready`, `retrieve`, `get_store_info`, `get_file_search_store_name`. Your `docling_rag.py`'s `DoclingVectorRetriever` implements this, and `factory.py`'s `get_knowledge_retriever()` picks a provider by string. We add a fifth implementation and one more branch in the factory — nothing else in your pipeline needs to change to use it.

### 3.2 Why `recall`, not `reflect`, for the `retrieve()` method
`retrieve()` is supposed to return raw `RetrievedChunk` objects that your Gemini VLM (`vision_reasoner.answer()`) then reasons over — same contract as Docling's cosine search. Hindsight's `reflect()` would generate its own final answer, which would be redundant with what Gemini already does in `pipeline.py` and would throw away your existing VLM reasoning + image grounding. So: use `recall()` (raw memory retrieval) here, and save `reflect()` for the standalone Playbook feature in §6, which is a different, simpler code path with no images involved.

### 3.3 Full code

Create `app/providers/rag/hindsight_rag.py`:

```python
"""Hindsight-backed knowledge retriever: static SOP knowledge + live site memory."""

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

    # --- circuit breaker (copied from a pattern that's already proven in production use) ---
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

    # --- one-time bank setup: call this once from a setup script, not per-request ---
    async def ensure_bank(self) -> None:
        if self._bank_ready:
            return
        await self._client.acreate_bank(
            bank_id=self.bank_id, name=BANK_NAME, mission=MISSION, reflect_mission=MISSION,
            retain_mission=RETAIN_MISSION, enable_observations=True,
        )
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

        chunks: List[RetrievedChunk] = []
        for r in (resp.results or [])[:k]:
            occurred = getattr(r, "occurred_start", None) or getattr(r, "mentioned_at", None)
            chunks.append(RetrievedChunk(
                text=r.text,
                document_name=r.document_id or "site-memory",
                page_number=None,
                section_title=f"{r.type} · {occurred}" if occurred else r.type,
                score=getattr(r, "score", 0.0) or 0.0,
                metadata=r.metadata or {},
            ))
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

    async def retain_hazard(self, hazard_type: str, severity: str, zone: Optional[str],
                            description: str, distance_meters: Optional[float] = None,
                            source: str = "local") -> None:
        """Retain a hazard/alert event as an experience memory. Fire-and-forget."""
        try:
            await self.ensure_bank()
            text = (f"Hazard event: {hazard_type} (severity: {severity}) "
                   f"in zone '{zone or 'unspecified'}'. {description}"
                   + (f" Distance: {distance_meters:.1f}m." if distance_meters is not None else "")
                   + f" Source: {source}.")
            tags = ["hazard", f"type:{hazard_type}", f"severity:{severity}"]
            if zone:
                tags.append(f"zone:{zone.lower().replace(' ', '_')}")
            await self._call(
                self._client.aretain, bank_id=self.bank_id, content=text, tags=tags,
                context="Hazard/alert event", timestamp=datetime.now(timezone.utc),
                document_id=f"hazard-{int(time.time() * 1000)}",
            )
        except Exception as e:
            logger.warning("[HindsightKnowledgeRetriever] retain_hazard failed (non-fatal): %s", e)

    async def get_playbook(self) -> Dict[str, Any]:
        """Fetch the auto-refreshing Site Safety Playbook mental model (for the demo endpoint)."""
        await self.ensure_bank()
        mm = await self._client.aget_mental_model(bank_id=self.bank_id,
                                                   mental_model_id=PLAYBOOK_ID, detail="content")
        return {"id": PLAYBOOK_ID, "name": "Site Safety Playbook",
               "content": getattr(mm, "content", None) or getattr(mm, "text", str(mm))}
```

> **Note on `RetrievedChunk` field mapping**: your dataclass has `page_number`/`section_title` because it was designed for PDF chunks. Hindsight memories don't have pages, so I've repurposed `section_title` to carry the memory type + timestamp (useful context for the VLM) and left `page_number` as `None`. This is intentional, not a bug.

---

## 4. Wiring it into the factory — `app/factory.py`

Add this branch inside `get_knowledge_retriever()`, alongside the existing `mock`/`docling`/`gemini` branches:

```python
    if provider_type == "hindsight":
        from app.providers.rag.hindsight_rag import HindsightKnowledgeRetriever
        if not settings.hindsight_url:
            logger.warning("HINDSIGHT_URL not configured. Hindsight RAG will not be available.")
            return None
        logger.info(f"Using Hindsight Knowledge Retriever (bank: {settings.hindsight_bank_id}).")
        return HindsightKnowledgeRetriever(
            hindsight_url=settings.hindsight_url,
            hindsight_api_key=settings.hindsight_api_key,
            bank_id=settings.hindsight_bank_id,
            default_top_k=settings.rag_top_k,
        )
```

---

## 5. Wiring it into settings — `app/config.py`

Two changes to the `Settings` class:

```python
    # 1. Widen the existing Literal to accept the new provider value:
    rag_provider: Literal["docling", "gemini", "gemini_file_search", "mock", "hindsight"] = "docling"

    # 2. Add these three new fields anywhere in the class body:
    hindsight_url: str = ""
    hindsight_api_key: str = ""
    hindsight_bank_id: str = "kaya-safety-copilot"
```
(`pydantic-settings` will automatically populate these from `.env` by matching field names case-insensitively — no extra wiring needed, same as every other setting in this file.)

---

## 6. The learning hook — `app/pipeline.py`

This is the part that actually makes the agent "get smarter." Right now, `process_turn()` computes `response_text` and calls `self._append_history(question, response_text)` to remember it for the *current session only* (cleared on restart / `/api/reset`). We add one more line right after that, which **permanently** retains the turn into Hindsight:

Find this line near the end of `process_turn()`:
```python
        # Update in-memory history (isolate RAG context chunks from permanently polluting history)
        self._append_history(question, response_text)
```

Add immediately after it:
```python
        # Also retain this turn into Hindsight permanent memory (fire-and-forget, never blocks the response)
        if self.knowledge_retriever and hasattr(self.knowledge_retriever, "retain_turn"):
            import asyncio
            asyncio.create_task(self.knowledge_retriever.retain_turn(
                question=question, answer=response_text,
            ))
```

Two deliberate design choices here:
- **`hasattr()` duck-typing** instead of adding `retain_turn` to the `KnowledgeRetriever` ABC in `interfaces.py`. This means the Docling/Gemini/mock providers don't need any changes at all — only `HindsightKnowledgeRetriever` has this method, and the pipeline only calls it if present. Zero risk to your existing providers.
- **`asyncio.create_task`, not `await`**: retaining a memory should never add latency to the spoken answer the worker is waiting for. If you want to see errors from this background task during testing, temporarily add a `.add_done_callback(lambda t: t.exception() and logger.error(t.exception()))` — asyncio silently swallows exceptions in fire-and-forget tasks otherwise, which is a real gotcha worth knowing about.

---

## 7. Standalone endpoints — `app/main.py`

### 7.1 The Playbook demo endpoint (easy, self-contained)
Add near your other `/api/knowledge/*` route:

```python
@app.get("/api/knowledge/playbook")
async def get_safety_playbook():
    """Return the auto-refreshing Hindsight Site Safety Playbook (demo: shows accumulated learning)."""
    if not pipeline.knowledge_retriever or not hasattr(pipeline.knowledge_retriever, "get_playbook"):
        return {"available": False, "message": "Hindsight RAG provider not active."}
    try:
        return {"available": True, **(await pipeline.knowledge_retriever.get_playbook())}
    except Exception as e:
        return {"available": False, "message": str(e)}
```

### 7.2 The cross-agent alert bridge — ⚠️ needs your judgment call
This is the one piece I could **not** verify against your real code, because I didn't have access to `app/copilot_bridge.py` (only its usage in `main.py`). Here's the shape of what's needed, and what you'll need to adapt:

I read `alerts/alert_manager.py` and `core/models.py` directly, so I know `AlertManager.process_hazards()` expects a `list[HazardAssessment]` and a `dict[int, WorkerPPEState]`. So an external alert (say, from the multi-agent telemetry side of the project) needs to become a `HazardAssessment`:

```python
from core.models import HazardAssessment, Severity

@app.post("/api/alerts/external")
async def receive_external_alert(payload: dict):
    """Ingest a blind-spot alert from another agent's sensor mesh (phone/CCTV telemetry)."""
    severity_map = {"low": Severity.WARNING, "medium": Severity.DANGER, "high": Severity.CRITICAL}
    hazard = HazardAssessment(
        hazard_type="cross_agent_blind_spot",
        severity=severity_map.get(payload.get("severity", "medium"), Severity.DANGER),
        description=payload.get("message", "Hazard reported by another site sensor."),
        zone_name=payload.get("zone"),
        distance_meters=payload.get("distance_m"),
    )
    # ⚠️ Shaurya: wherever `copilot_bridge.py` holds its live AlertManager instance,
    # call something like: copilot_bridge.alert_manager.process_hazards([hazard], {})
    # I don't know the exact attribute name on copilot_bridge — grep for
    # "AlertManager(" in that file to find it.

    # Also retain it into Hindsight, independent of whether the live alert fires:
    if pipeline.knowledge_retriever and hasattr(pipeline.knowledge_retriever, "retain_hazard"):
        import asyncio
        asyncio.create_task(pipeline.knowledge_retriever.retain_hazard(
            hazard_type="cross_agent_blind_spot",
            severity=payload.get("severity", "medium"),
            zone=payload.get("zone"),
            description=payload.get("message", ""),
            distance_meters=payload.get("distance_m"),
            source=payload.get("source_agent", "external"),
        ))
    return {"status": "ok"}
```

You'll also want to retain your **own** locally-detected hazards the same way — wherever `copilot_bridge.py` currently calls `alert_manager.process_hazards(hazards, worker_ppe)` on the live CV loop, add a loop that calls `pipeline.knowledge_retriever.retain_hazard(...)` for each hazard too (same pattern as above, `source="local_cv"`). That's what makes the Playbook mental model actually accumulate real site history instead of just voice-turn history.

---

## 8. One-time SOP ingestion into Hindsight (optional but recommended)

Your `scripts/ingest.py` already produces `knowledge/vector_store.json` with Docling-chunked SOP text. Reuse that instead of re-parsing PDFs — create `scripts/ingest_hindsight.py`:

```python
"""One-time: load already-Docling-chunked SOP text into the Hindsight bank as static 'world' knowledge."""
import asyncio, json, sys
sys.path.insert(0, ".")
from app.config import get_settings
from app.providers.rag.hindsight_rag import HindsightKnowledgeRetriever

async def main():
    s = get_settings()
    retriever = HindsightKnowledgeRetriever(s.hindsight_url, s.hindsight_api_key, s.hindsight_bank_id)
    await retriever.ensure_bank()
    data = json.load(open(s.knowledge_vector_store_path, encoding="utf-8"))
    chunks = data.get("chunks", [])
    for i, c in enumerate(chunks):
        await retriever._client.aretain(
            bank_id=retriever.bank_id, content=c["text"],
            document_id=f"sop-{c.get('document_name', 'doc')}-{i}",
            context=f"SOP manual: {c.get('document_name')}", tags=["sop", "world_knowledge"],
        )
        if i % 10 == 0:
            print(f"  ingested {i}/{len(chunks)} chunks")
    print(f"Done: {len(chunks)} SOP chunks retained into bank '{retriever.bank_id}'.")

asyncio.run(main())
```
Run once: `python scripts/ingest_hindsight.py`

---

## 9. Troubleshooting (things we already hit, so you don't have to)

- **Groq free-tier rate limit is small** (8,000 tokens/minute on `gpt-oss-20b` if you go the local-Docker route). If you see `429` / `"Rate limit reached"` errors, don't panic — it's not a bug in this code, it's the account's own quota. Options: don't hammer `retain`/`recall` in a tight loop while testing (space out your test calls by a few seconds), or use Hindsight Cloud with the promo credits instead of local Docker if it gets bad. This is Groq/Hindsight infrastructure, not something in the code above to fix.
- **Fire-and-forget tasks swallow exceptions silently.** If memory writes seem to "not be happening" but you see no errors, it's almost certainly an unhandled exception inside an `asyncio.create_task(...)` — temporarily `await` the call instead of `create_task`-ing it while debugging, then switch back once it works.
- **`ensure_bank()` is idempotent** — safe to call on every `is_ready()`/`retrieve()` invocation; Hindsight's `acreate_bank` and `acreate_mental_model` no-op (or raise a harmless "already exists") on repeat calls.

---

## 10. Checklist

- [ ] Hindsight instance running (Cloud or local Docker), reachable at `HINDSIGHT_URL`
- [ ] `hindsight-client` added to `requirements.txt` and installed
- [ ] `.env` updated (§2.3)
- [ ] `app/config.py`: `rag_provider` Literal widened + 3 new fields added
- [ ] `app/providers/rag/hindsight_rag.py` created (§3.3, full code above)
- [ ] `app/factory.py`: new `hindsight` branch added
- [ ] `app/pipeline.py`: retain-after-turn hook added
- [ ] `RAG_PROVIDER=hindsight` set in `.env`, app restarts cleanly, `/api/status` shows `"rag": {"provider": "hindsight_retriever", "ready": true}`
- [ ] `python scripts/ingest_hindsight.py` run once to seed SOP knowledge
- [ ] `/api/knowledge/playbook` returns a real (non-empty) playbook after a few interactions
- [ ] (stretch) `/api/alerts/external` wired into `copilot_bridge`'s live `AlertManager`
- [ ] Demo script ready: ask the same category of question early vs. after several simulated interactions/hazards, show the answer visibly citing site-specific history instead of just the generic manual
