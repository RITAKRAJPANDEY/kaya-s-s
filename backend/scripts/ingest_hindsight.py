#!/usr/bin/env python3
"""One-time: load already-Docling-chunked SOP text into the Hindsight bank as static 'world' knowledge.

Reuses the vector_store.json produced by scripts/ingest.py instead of re-parsing PDFs.

Usage:
    python scripts/ingest_hindsight.py
"""

import asyncio
import json
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from hindsight_client_api.exceptions import ServiceException

from app.config import get_settings
from app.providers.rag.hindsight_rag import HindsightKnowledgeRetriever

# Groq's free on_demand tier caps at 8,000 tokens/minute; each retain's fact-extraction
# call burns a few thousand tokens, so we pace requests and back off on 429s.
DELAY_BETWEEN_RETAINS_S = 8.0
RATE_LIMIT_BACKOFF_S = 20.0
MAX_RETRIES = 3


async def retain_with_backoff(retriever: HindsightKnowledgeRetriever, **kwargs) -> None:
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            await retriever._client.aretain(**kwargs)
            return
        except ServiceException as e:
            if "rate_limit" in str(e) or "429" in str(e):
                print(f"  rate limited, backing off {RATE_LIMIT_BACKOFF_S}s (attempt {attempt}/{MAX_RETRIES})")
                await asyncio.sleep(RATE_LIMIT_BACKOFF_S)
                continue
            raise
    raise RuntimeError(f"Gave up after {MAX_RETRIES} retries due to persistent rate limiting.")


async def main() -> None:
    settings = get_settings()
    if not settings.hindsight_url:
        print("HINDSIGHT_URL is not set in .env — nothing to ingest into.")
        return

    retriever = HindsightKnowledgeRetriever(
        settings.hindsight_url, settings.hindsight_api_key, settings.hindsight_bank_id
    )
    await retriever.ensure_bank()

    store_path = Path(settings.knowledge_vector_store_path)
    if not store_path.exists():
        print(f"No vector store found at '{store_path}'. Run scripts/ingest.py first.")
        return

    data = json.loads(store_path.read_text(encoding="utf-8"))
    chunks = data.get("chunks", [])
    if not chunks:
        print(f"'{store_path}' has no chunks to ingest.")
        return

    for i, c in enumerate(chunks):
        await retain_with_backoff(
            retriever,
            bank_id=retriever.bank_id, content=c["text"],
            document_id=f"sop-{c.get('document_name', 'doc')}-{i}",
            context=f"SOP manual: {c.get('document_name')}", tags=["sop", "world_knowledge"],
        )
        print(f"  ingested {i + 1}/{len(chunks)} chunks")
        if i < len(chunks) - 1:
            await asyncio.sleep(DELAY_BETWEEN_RETAINS_S)

    print(f"Done: {len(chunks)} SOP chunks retained into bank '{retriever.bank_id}'.")


if __name__ == "__main__":
    asyncio.run(main())
