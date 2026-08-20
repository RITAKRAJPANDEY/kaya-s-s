"""Unit and integration tests for Kaya RAG subsystem."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.config import Settings
from app.interfaces import KnowledgeRetriever
from app.rag.router import RAGRouter, RAGRoutingDecision
from app.providers.rag.mock_rag import MockKnowledgeRetriever
from app.pipeline import KayaPipeline
from app.providers.stt.mock_stt import MockSTTProvider
from app.providers.vision.mock_vision import MockVisionReasoner
from app.providers.tts.mock_tts import MockTTSProvider


def test_rag_router_decisions():
    """Verify that the RAG router accurately distinguishes knowledge vs visual queries."""
    router = RAGRouter(mode="auto")

    # Non-RAG Queries (Pure Visual observation)
    assert not router.route("What color is that helmet?").requires_rag
    assert not router.route("What is that object?").requires_rag
    assert not router.route("What am I looking at?").requires_rag
    assert not router.route("Describe the scene in front of me").requires_rag
    assert not router.route("How many people are there?").requires_rag
    assert not router.route("Is the light on?").requires_rag

    # RAG Queries (Policy, Manual, Rules, Compliance, SOP)
    assert router.route("What does the safety manual say about working at height?").requires_rag
    assert router.route("What are the ladder requirements in our safety documents?").requires_rag
    assert router.route("Is this safe according to our site safety manual?").requires_rag
    assert router.route("What does the manual say about this equipment?").requires_rag
    assert router.route("According to our documents, what should I do here?").requires_rag
    assert router.route("What is the SOP for scaffolding over 2 meters?").requires_rag
    assert router.route("Are workers compliant with our PPE policy?").requires_rag
    assert router.route("What is the required tie-off distance for fall protection?").requires_rag


def test_rag_router_modes():
    """Verify router modes: always and never."""
    router_always = RAGRouter(mode="always")
    assert router_always.route("What color is that?").requires_rag

    router_never = RAGRouter(mode="never")
    assert not router_never.route("What does the safety manual say?").requires_rag


@pytest.mark.asyncio
async def test_mock_knowledge_retriever():
    """Verify MockKnowledgeRetriever interface compliance."""
    retriever = MockKnowledgeRetriever(is_ready_val=True, store_name="test_store_123")
    assert retriever.name == "mock_rag"
    assert await retriever.is_ready()

    info = await retriever.get_store_info()
    assert info["ready"]
    assert info["document_count"] == 5

    chunks = await retriever.retrieve("ladder safety rules", top_k=2)
    assert len(chunks) == 2
    assert chunks[0].document_name == "site_safety_manual.txt"
    assert chunks[0].score > 0.8


def test_local_vector_store_cosine_search(tmp_path):
    """Verify LocalVectorStore search calculation."""
    from app.providers.rag.docling_rag import LocalVectorStore
    import json

    test_file = tmp_path / "vector_store.json"
    data = {
        "metadata": {"document_count": 2, "chunk_count": 2},
        "chunks": [
            {
                "id": "c1",
                "text": "Ladder safety requirements: 4 to 1 slope rule.",
                "document_name": "ladder_sop.txt",
                "page_number": 3,
                "section_title": "Setup",
                "embedding": [1.0, 0.0, 0.0],
            },
            {
                "id": "c2",
                "text": "Excavation and trenching protocols.",
                "document_name": "trench_sop.txt",
                "page_number": 1,
                "section_title": "Excavation",
                "embedding": [0.0, 1.0, 0.0],
            },
        ],
    }
    with open(test_file, "w") as f:
        json.dump(data, f)

    store = LocalVectorStore(store_path=str(test_file))
    assert store.is_ready()

    # Query with vector parallel to c1
    results = store.search(query_embedding=[0.9, 0.1, 0.0], top_k=1)
    assert len(results) == 1
    assert results[0].document_name == "ladder_sop.txt"
    assert results[0].page_number == 3
    assert results[0].score > 0.9


@pytest.mark.asyncio
async def test_pipeline_with_rag_enabled():
    """Verify pipeline execution routes RAG questions and attaches source citations."""
    settings = Settings(
        rag_enabled=True,
        rag_router_mode="auto",
        frame_mode="SINGLE_FRAME"
    )
    pipeline = KayaPipeline(
        settings=settings,
        stt_provider=MockSTTProvider(default_transcript="Is this safe according to our safety manual?"),
        vision_reasoner=MockVisionReasoner(),
        tts_provider=MockTTSProvider(),
        knowledge_retriever=MockKnowledgeRetriever(is_ready_val=True, store_name="test_store"),
    )

    dummy_image = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x01\x00`\x00`\x00\x00\xff\xdb\x00C\x00\xff\xc0\x00\x0b\x08\x00\x01\x00\x01\x01\x01\x11\x00\xff\xc4\x00\x1f\x00\x00\x01\x05\x01\x01\x01\x01\x01\x01\x00\x00\x00\x00\x00\x00\x00\x00\x01\x02\x03\x04\x05\x06\x07\x08\t\n\x0b\xff\xda\x00\x08\x01\x01\x00\x00?\x00\xbf\x00\xff\xd9"
    result = await pipeline.process_turn(
        direct_question="Is this safe according to our safety manual?",
        image_bytes=dummy_image,
    )

    assert result["rag"]["requires_rag"] is True
    assert result["rag"]["used"] is True
    assert len(result["rag"]["sources"]) > 0
    assert "router_ms" in result["timings"]
    assert "retrieval_ms" in result["timings"]
    assert result["timings"]["router_ms"] >= 0


@pytest.mark.asyncio
async def test_pipeline_non_rag_query():
    """Verify pipeline bypasses knowledge store for pure visual query."""
    settings = Settings(
        rag_enabled=True,
        rag_router_mode="auto",
        frame_mode="SINGLE_FRAME"
    )
    pipeline = KayaPipeline(
        settings=settings,
        stt_provider=MockSTTProvider(),
        vision_reasoner=MockVisionReasoner(),
        tts_provider=MockTTSProvider(),
        knowledge_retriever=MockKnowledgeRetriever(is_ready_val=True, store_name="test_store"),
    )

    dummy_image = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x01\x00`\x00`\x00\x00\xff\xdb\x00C\x00\xff\xc0\x00\x0b\x08\x00\x01\x00\x01\x01\x01\x11\x00\xff\xc4\x00\x1f\x00\x00\x01\x05\x01\x01\x01\x01\x01\x01\x00\x00\x00\x00\x00\x00\x00\x00\x01\x02\x03\x04\x05\x06\x07\x08\t\n\x0b\xff\xda\x00\x08\x01\x01\x00\x00?\x00\xbf\x00\xff\xd9"
    result = await pipeline.process_turn(
        direct_question="What color is that helmet?",
        image_bytes=dummy_image,
    )

    assert result["rag"]["requires_rag"] is False
    assert result["rag"]["used"] is False
    assert len(result["rag"]["sources"]) == 0

