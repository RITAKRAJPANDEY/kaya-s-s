from typing import Any, Dict, List, Optional
from app.interfaces import KnowledgeRetriever, RetrievedChunk


class MockKnowledgeRetriever(KnowledgeRetriever):
    """Mock implementation of KnowledgeRetriever for test suites."""

    def __init__(self, is_ready_val: bool = True, store_name: str = "mock_store"):
        self._is_ready = is_ready_val
        self._store_name = store_name

    @property
    def name(self) -> str:
        return "mock_rag"

    async def is_ready(self) -> bool:
        return self._is_ready

    async def retrieve(self, query: str, top_k: int = 4) -> List[RetrievedChunk]:
        if not self._is_ready:
            return []
        return [
            RetrievedChunk(
                text=f"Mock safety documentation excerpt addressing '{query}'. Fall protection required above 6ft.",
                document_name="site_safety_manual.txt",
                page_number=1,
                section_title="Working at Height",
                score=0.92,
            ),
            RetrievedChunk(
                text="Ladders must be positioned at a 4:1 slope ratio and extend 3 feet past upper landings.",
                document_name="ladder_safety_sop.txt",
                page_number=2,
                section_title="Setup & Positioning",
                score=0.88,
            )
        ]

    async def get_store_info(self) -> Dict[str, Any]:
        return {
            "ready": self._is_ready,
            "provider": self.name,
            "store_name": self._store_name,
            "document_count": 5,
            "chunk_count": 12,
            "documents": ["site_safety_manual.txt", "ladder_safety_sop.txt"],
            "message": "Mock knowledge base ready.",
        }

    def get_file_search_store_name(self) -> Optional[str]:
        return self._store_name if self._is_ready else None

