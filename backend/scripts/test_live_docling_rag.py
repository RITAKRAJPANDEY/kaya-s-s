#!/usr/bin/env python3
"""Live End-to-End Test for Kaya Docling Structure-Aware RAG.

Tests 3 specific scenarios:
1. A normal visual question -> no RAG
2. A construction safety question -> RAG (Docling chunks + citations)
3. "Is this safe according to the manual?" -> Camera + RAG + Reasoning
"""

import asyncio
import io
import logging
import sys
import time
from pathlib import Path
from PIL import Image, ImageDraw

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from app.config import get_settings
from app.factory import get_stt_provider, get_vision_reasoner, get_tts_provider, get_knowledge_retriever
from app.pipeline import KayaPipeline

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")


def create_ladder_scene_image() -> bytes:
    """Create a synthetic high-resolution image of a worker on an extension ladder."""
    img = Image.new("RGB", (640, 480), color=(135, 206, 235))  # Sky blue background
    draw = ImageDraw.Draw(img)

    # Ground
    draw.rectangle([(0, 400), (640, 480)], fill=(139, 69, 19))

    # Building Wall
    draw.rectangle([(380, 50), (640, 400)], fill=(178, 34, 34))

    # Ladder (Leaning against wall at steep angle)
    ladder_rails = [(260, 400), (420, 70)]
    draw.line([ladder_rails[0], ladder_rails[1]], fill=(192, 192, 192), width=8)
    draw.line([(ladder_rails[0][0] + 35, ladder_rails[0][1]), (ladder_rails[1][0] + 35, ladder_rails[1][1])], fill=(192, 192, 192), width=8)

    # Ladder rungs
    for i in range(1, 10):
        t = i / 10.0
        x1 = int(260 + t * (420 - 260))
        y1 = int(400 + t * (70 - 400))
        draw.line([(x1, y1), (x1 + 35, y1)], fill=(128, 128, 128), width=5)

    # Worker near the very top rung (standing on top step, holding drill with one hand, reaching outward)
    worker_x, worker_y = 390, 110
    # Hardhat (Yellow)
    draw.ellipse([(worker_x - 12, worker_y - 25), (worker_x + 12, worker_y - 5)], fill=(255, 215, 0))
    # Torso with Hi-Vis Vest (Orange)
    draw.rectangle([(worker_x - 15, worker_y), (worker_x + 15, worker_y + 40)], fill=(255, 69, 0))
    # Legs (Jeans)
    draw.rectangle([(worker_x - 12, worker_y + 40), (worker_x - 2, worker_y + 70)], fill=(0, 0, 139))
    draw.rectangle([(worker_x + 2, worker_y + 40), (worker_x + 12, worker_y + 70)], fill=(0, 0, 139))

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=90)
    return buf.getvalue()


async def run_live_tests():
    settings = get_settings()
    print("=" * 65)
    print("KAYA AI — PHASE 1 DOCLING RAG VERIFICATION RUNNER")
    print(f"RAG Provider:    {settings.rag_provider}")
    print(f"Embedding Model: {settings.embedding_model}")
    print(f"Vision Model:    {settings.gemini_model}")
    print(f"Vector Store:    {settings.knowledge_vector_store_path}")
    print("=" * 65)

    pipeline = KayaPipeline(settings=settings)
    camera_image = create_ladder_scene_image()

    test_queries = [
        ("TEST 1: Normal Visual Question (Expected: No RAG)", "What color is the hardhat and vest on the worker?"),
        ("TEST 2: Construction Safety Question (Expected: RAG retrieved chunks)", "What are the ladder setup and positioning rules according to our documents?"),
        ("TEST 3: Multimodal Compliance Reasoning (Expected: Camera + RAG + Reasoning)", "Is this safe according to the safety manual?"),
    ]

    for test_title, question in test_queries:
        print("\n" + "#" * 65)
        print(f"{test_title}")
        print(f"Question: \"{question}\"")
        print("#" * 65)

        t0 = time.perf_counter()
        result = await pipeline.process_turn(
            direct_question=question,
            image_bytes=camera_image,
        )
        total_time = time.perf_counter() - t0

        rag_meta = result.get("rag", {})
        print(f"\n[Result Overview]")
        print(f" - RAG Required: {rag_meta.get('requires_rag')}")
        print(f" - RAG Reason:   {rag_meta.get('reason')}")
        print(f" - RAG Used:     {rag_meta.get('used')}")
        print(f" - Sources ({len(rag_meta.get('sources', []))}):")
        for s in rag_meta.get("sources", []):
            page_info = f" (Page: {s.get('page')})" if s.get('page') else ""
            sec_info = f" [Section: {s.get('section')}]" if s.get('section') else ""
            score_info = f" (Score: {s.get('score')})" if s.get('score') else ""
            print(f"    * {s.get('title')}{page_info}{sec_info}{score_info}")

        print(f"\n[Response Text]:\n{result.get('response')}\n")
        print(f"[Timings]: Total {total_time:.2f}s | Router: {result['timings']['formatted']['router']} | Retrieval: {result['timings']['formatted'].get('retrieval', 'N/A')} | Vision: {result['timings']['formatted']['vision']} | TTS: {result['timings']['formatted']['tts']}")
        print("-" * 65)


if __name__ == "__main__":
    asyncio.run(run_live_tests())
