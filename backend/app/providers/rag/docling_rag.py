"""Docling Structure-Aware Chunking & Local Vector Knowledge Retriever."""

import asyncio
import json
import logging
import os
from typing import Any, Dict, List, Optional
import numpy as np
from google import genai

from app.interfaces import KnowledgeRetriever, RetrievedChunk

logger = logging.getLogger("kaya.providers.rag.docling")


class LocalVectorStore:
    """Lightweight, self-contained local vector store with cosine similarity retrieval."""

    def __init__(self, store_path: str = "knowledge/vector_store.json"):
        self.store_path = store_path
        self.chunks: List[Dict[str, Any]] = []
        self.embedding_matrix: Optional[np.ndarray] = None
        self.metadata: Dict[str, Any] = {}
        self.load()

    def load(self) -> bool:
        """Load vector store index and pre-compute normalized embedding matrix."""
        if not os.path.exists(self.store_path):
            logger.debug(f"[LocalVectorStore] Index file not found at '{self.store_path}'")
            return False

        try:
            with open(self.store_path, "r", encoding="utf-8") as f:
                data = json.load(f)

            self.metadata = data.get("metadata", {})
            self.chunks = data.get("chunks", [])

            if self.chunks:
                embeddings = []
                for c in self.chunks:
                    emb = c.get("embedding", [])
                    embeddings.append(emb)

                raw_matrix = np.array(embeddings, dtype=np.float32)
                # Compute L2 unit norms for fast cosine similarity dot products
                norms = np.linalg.norm(raw_matrix, axis=1, keepdims=True)
                norms[norms == 0] = 1.0  # Prevent division by zero
                self.embedding_matrix = raw_matrix / norms
                logger.info(f"[LocalVectorStore] Loaded {len(self.chunks)} chunks from '{self.store_path}'")
                return True
            else:
                self.embedding_matrix = None
                return False

        except Exception as e:
            logger.error(f"[LocalVectorStore] Error loading '{self.store_path}': {e}")
            self.chunks = []
            self.embedding_matrix = None
            return False

    def is_ready(self) -> bool:
        return bool(self.chunks and self.embedding_matrix is not None and len(self.chunks) > 0)

    def search(self, query_embedding: List[float], top_k: int = 4) -> List[RetrievedChunk]:
        """Perform fast cosine similarity search against stored structure-aware chunks."""
        if not self.is_ready() or self.embedding_matrix is None:
            return []

        try:
            q_vec = np.array(query_embedding, dtype=np.float32)
            q_norm = np.linalg.norm(q_vec)
            if q_norm == 0:
                return []
            q_unit = q_vec / q_norm

            # Cosine similarity is simply the matrix-vector dot product of normalized vectors
            scores = np.dot(self.embedding_matrix, q_unit)
            top_k = min(top_k, len(self.chunks))
            top_indices = np.argsort(scores)[::-1][:top_k]

            results = []
            for idx in top_indices:
                score = float(scores[idx])
                chunk_data = self.chunks[idx]
                results.append(
                    RetrievedChunk(
                        text=chunk_data.get("text", ""),
                        document_name=chunk_data.get("document_name", "document"),
                        page_number=chunk_data.get("page_number"),
                        section_title=chunk_data.get("section_title"),
                        score=round(score, 4),
                        metadata=chunk_data.get("metadata", {}),
                    )
                )
            return results

        except Exception as e:
            logger.error(f"[LocalVectorStore] Search calculation error: {e}")
            return []


class DoclingVectorRetriever(KnowledgeRetriever):
    """Knowledge retriever powered by Docling structure-aware chunks and Gemini embeddings."""

    def __init__(
        self,
        api_key: str,
        embedding_model: str = "gemini-embedding-001",
        store_path: str = "knowledge/vector_store.json",
        default_top_k: int = 4,
    ):
        self.api_key = api_key
        self.embedding_model = embedding_model
        self.store_path = store_path
        self.default_top_k = default_top_k
        self.client = genai.Client(api_key=self.api_key) if self.api_key else None
        self.vector_store = LocalVectorStore(store_path=self.store_path)

    @property
    def name(self) -> str:
        return "docling_vector_retriever"

    async def is_ready(self) -> bool:
        if not self.vector_store.is_ready():
            # Try reloading in case ingestion recently finished
            self.vector_store.load()
        return self.vector_store.is_ready()

    async def get_store_info(self) -> Dict[str, Any]:
        ready = await self.is_ready()
        return {
            "provider": self.name,
            "ready": ready,
            "embedding_model": self.embedding_model,
            "document_count": self.vector_store.metadata.get("document_count", 0),
            "chunk_count": len(self.vector_store.chunks),
            "store_path": self.store_path,
            "last_updated": self.vector_store.metadata.get("created_at"),
        }

    def get_file_search_store_name(self) -> Optional[str]:
        return None

    async def retrieve(self, query: str, top_k: Optional[int] = None) -> List[RetrievedChunk]:
        """Generate query embedding and retrieve the top-k most relevant Docling chunks."""
        k = top_k or self.default_top_k
        if not query or not query.strip():
            return []

        if not await self.is_ready():
            logger.warning("[DoclingVectorRetriever] Vector store is not ready or has no chunks indexed.")
            return []

        if not self.client:
            logger.error("[DoclingVectorRetriever] Gemini API client not configured for embeddings.")
            return []

        try:
            # Generate embedding for user question via Gemini
            loop = asyncio.get_running_loop()
            res = await loop.run_in_executor(
                None,
                lambda: self.client.models.embed_content(
                    model=self.embedding_model,
                    contents=query.strip(),
                ),
            )

            emb = None
            if hasattr(res, "embedding") and hasattr(res.embedding, "values"):
                emb = res.embedding.values
            elif hasattr(res, "embeddings") and len(res.embeddings) > 0:
                emb = res.embeddings[0].values

            if not emb:
                logger.error("[DoclingVectorRetriever] Empty embedding returned by Gemini.")
                return []

            # Retrieve top chunks from local vector store
            chunks = self.vector_store.search(query_embedding=emb, top_k=k)
            logger.info(f"[DoclingVectorRetriever] Retrieved {len(chunks)} chunks for query: '{query[:50]}...'")
            return chunks

        except Exception as e:
            logger.error(f"[DoclingVectorRetriever] Retrieval failed: {e}")
            return []
