"""Google Gemini File Search Knowledge Retriever Provider."""

import json
import logging
import os
from typing import Any, Dict, List, Optional
from google import genai
from google.genai import types

from app.interfaces import KnowledgeRetriever

logger = logging.getLogger("kaya.providers.rag.gemini")


class GeminiFileSearchRetriever(KnowledgeRetriever):
    """Knowledge retriever powered by Google Gemini File Search Stores."""

    def __init__(
        self,
        api_key: str,
        store_name: Optional[str] = None,
        manifest_path: str = "knowledge/manifest.json",
        knowledge_dir: str = "knowledge/documents",
    ):
        if not api_key:
            raise ValueError("Gemini API key is required for GeminiFileSearchRetriever.")
        self.api_key = api_key
        self.client = genai.Client(api_key=self.api_key)
        self.manifest_path = manifest_path
        self.knowledge_dir = knowledge_dir
        self._store_name: Optional[str] = store_name

        # Attempt to resolve store_name from manifest if not explicitly given
        if not self._store_name:
            self._load_store_from_manifest()

    @property
    def name(self) -> str:
        return "gemini_file_search"

    def _load_store_from_manifest(self) -> None:
        """Load active store metadata from manifest file if available."""
        if os.path.exists(self.manifest_path):
            try:
                with open(self.manifest_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    self._store_name = data.get("store_name")
                    if self._store_name:
                        logger.info(f"[GeminiFileSearchRetriever] Loaded store name from manifest: {self._store_name}")
            except Exception as e:
                logger.warning(f"[GeminiFileSearchRetriever] Failed reading manifest at '{self.manifest_path}': {e}")

    def get_file_search_store_name(self) -> Optional[str]:
        """Return the active Gemini File Search store resource name."""
        if not self._store_name:
            self._load_store_from_manifest()
        return self._store_name

    def set_store_name(self, store_name: str) -> None:
        """Set the active Gemini File Search store resource name."""
        self._store_name = store_name

    async def is_ready(self) -> bool:
        """Verify whether the knowledge store is configured and available."""
        store_name = self.get_file_search_store_name()
        if not store_name:
            return False
        try:
            store = self.client.file_search_stores.get(name=store_name)
            return store is not None and bool(store.name)
        except Exception as e:
            logger.warning(f"[GeminiFileSearchRetriever] Store check failed for '{store_name}': {e}")
            return False

    async def get_store_info(self) -> Dict[str, Any]:
        """Return knowledge store status and document counts."""
        store_name = self.get_file_search_store_name()
        if not store_name:
            # Check local documents directory
            local_doc_count = 0
            if os.path.exists(self.knowledge_dir):
                local_doc_count = len([
                    f for f in os.listdir(self.knowledge_dir)
                    if not f.startswith(".") and os.path.isfile(os.path.join(self.knowledge_dir, f))
                ])
            return {
                "ready": False,
                "provider": self.name,
                "store_name": None,
                "document_count": 0,
                "local_document_count": local_doc_count,
                "message": "Knowledge base not ingested. Run 'python scripts/ingest.py' to initialize.",
            }

        try:
            store = self.client.file_search_stores.get(name=store_name)
            doc_list = []
            if hasattr(self.client.file_search_stores, "documents"):
                try:
                    for doc in self.client.file_search_stores.documents.list(parent=store_name):
                        doc_list.append({
                            "name": doc.name,
                            "display_name": getattr(doc, "display_name", os.path.basename(doc.name)),
                            "state": str(getattr(doc, "state", "ACTIVE")),
                        })
                except Exception:
                    pass

            # Also check manifest for local document names
            manifest_docs = []
            if os.path.exists(self.manifest_path):
                try:
                    with open(self.manifest_path, "r", encoding="utf-8") as f:
                        m_data = json.load(f)
                        manifest_docs = list(m_data.get("documents", {}).keys())
                except Exception:
                    pass

            doc_count = len(doc_list) if doc_list else len(manifest_docs)

            return {
                "ready": True,
                "provider": self.name,
                "store_name": store.name,
                "display_name": getattr(store, "display_name", "Kaya Knowledge Base"),
                "document_count": doc_count,
                "documents": manifest_docs or [d["display_name"] for d in doc_list],
                "message": f"Knowledge base ready ({doc_count} document{'s' if doc_count != 1 else ''} indexed).",
            }
        except Exception as e:
            logger.error(f"[GeminiFileSearchRetriever] Error querying store info: {e}")
            return {
                "ready": False,
                "provider": self.name,
                "store_name": store_name,
                "document_count": 0,
                "error": str(e),
                "message": f"Error connecting to Gemini File Search Store: {e}",
            }
