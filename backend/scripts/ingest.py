#!/usr/bin/env python3
"""Docling Structure-Aware Ingestion CLI for Kaya AI.

Ingests construction safety PDFs, manuals, and SOPs using Docling HybridChunker,
generates Gemini embeddings (gemini-embedding-001), and creates a local vector index.

Usage:
    python scripts/ingest.py
    python scripts/ingest.py --dir knowledge/documents
    python scripts/ingest.py --dir pdfs_for_rag --force
"""

import argparse
import datetime
import hashlib
import json
import logging
import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

# Ensure project root is in python path
ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR))

from google import genai
from app.config import get_settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("kaya.ingest")


def compute_file_hash(file_path: Path) -> str:
    """Compute SHA256 hash of a file for change detection."""
    hasher = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(65536):
            hasher.update(chunk)
    return hasher.hexdigest()


def extract_chunk_page_number(chunk_meta: Any) -> Optional[int]:
    """Extract page number from Docling chunk metadata if present."""
    if hasattr(chunk_meta, "doc_items") and chunk_meta.doc_items:
        for item in chunk_meta.doc_items:
            if hasattr(item, "prov") and item.prov:
                for p in item.prov:
                    if hasattr(p, "page_no") and p.page_no is not None:
                        return int(p.page_no)
    return None


def extract_chunk_headings(chunk_meta: Any) -> List[str]:
    """Extract heading hierarchy from Docling chunk metadata."""
    headings = getattr(chunk_meta, "headings", [])
    if isinstance(headings, list):
        return [str(h) for h in headings if h]
    elif headings:
        return [str(headings)]
    return []


def parse_document_with_docling(file_path: Path) -> List[Dict[str, Any]]:
    """Convert and chunk a document with Docling DocumentConverter and HybridChunker."""
    from docling.document_converter import DocumentConverter, PdfFormatOption
    from docling.datamodel.pipeline_options import PdfPipelineOptions
    from docling.chunking import HybridChunker

    # Configure fast digital PDF pipeline (do_ocr=False for programmatic PDF speed)
    pipeline_options = PdfPipelineOptions(do_ocr=False)
    converter = DocumentConverter(
        format_options={
            "pdf": PdfFormatOption(pipeline_options=pipeline_options)
        }
    )

    logger.info(f"  Parsing with Docling: '{file_path.name}' ({file_path.stat().st_size / 1024:.1f} KB)...")
    t0 = time.perf_counter()
    conv_res = converter.convert(str(file_path))
    doc = conv_res.document

    chunker = HybridChunker()
    doc_chunks = list(chunker.chunk(doc))
    parse_duration = time.perf_counter() - t0
    logger.info(f"  Generated {len(doc_chunks)} structure-aware chunks in {parse_duration:.2f}s")

    extracted = []
    for i, c in enumerate(doc_chunks):
        text = c.text.strip()
        if not text:
            continue

        headings = extract_chunk_headings(c.meta)
        page_no = extract_chunk_page_number(c.meta)
        section_title = headings[-1] if headings else None

        extracted.append({
            "chunk_id": f"{file_path.stem}_{i}",
            "text": text,
            "document_name": file_path.name,
            "page_number": page_no,
            "section_title": section_title,
            "metadata": {
                "headings": headings,
                "file_size": file_path.stat().st_size,
                "char_length": len(text),
            }
        })

    return extracted


def generate_embeddings_batch(
    client: genai.Client,
    model: str,
    texts: List[str],
    batch_size: int = 10
) -> List[List[float]]:
    """Generate embeddings for a list of texts using Gemini API."""
    embeddings: List[List[float]] = []

    for i in range(0, len(texts), batch_size):
        batch = texts[i:i + batch_size]
        for t in batch:
            try:
                res = client.models.embed_content(
                    model=model,
                    contents=t,
                )
                emb = None
                if hasattr(res, "embedding") and hasattr(res.embedding, "values"):
                    emb = res.embedding.values
                elif hasattr(res, "embeddings") and len(res.embeddings) > 0:
                    emb = res.embeddings[0].values

                if emb:
                    embeddings.append(list(emb))
                else:
                    logger.warning(f"Empty embedding for text snippet: {t[:40]}...")
                    embeddings.append([0.0] * 3072)
            except Exception as e:
                logger.error(f"Error embedding chunk ({t[:30]}...): {e}")
                time.sleep(1.0)
                # Retry once
                try:
                    res = client.models.embed_content(model=model, contents=t)
                    emb = res.embedding.values if hasattr(res, "embedding") else res.embeddings[0].values
                    embeddings.append(list(emb))
                except Exception as retry_e:
                    logger.error(f"Retry failed for chunk: {retry_e}")
                    embeddings.append([0.0] * 3072)

    return embeddings


def run_ingestion(
    input_dir: str = "knowledge/documents",
    output_index_path: str = "knowledge/vector_store.json",
    manifest_path: str = "knowledge/manifest.json",
    embedding_model: str = "gemini-embedding-001",
    force: bool = False,
):
    """Run full Docling ingestion on documents and save local vector store."""
    settings = get_settings()
    api_key = settings.gemini_api_key

    if not api_key:
        logger.error("GEMINI_API_KEY is required for embedding generation. Please set it in .env.")
        sys.exit(1)

    client = genai.Client(api_key=api_key)

    doc_dir = ROOT_DIR / input_dir
    if not doc_dir.exists():
        logger.error(f"Knowledge directory '{doc_dir}' does not exist.")
        sys.exit(1)

    # Gather supported documents
    supported_exts = {".pdf", ".txt", ".md"}
    doc_files = [
        p for p in doc_dir.iterdir()
        if p.suffix.lower() in supported_exts
        and not p.name.startswith(".")
        and not p.name.endswith(".orig")
        and not p.name.endswith(".tmp")
    ]

    if not doc_files:
        logger.warning(f"No supported documents found in '{doc_dir}'.")
        return

    logger.info("=" * 60)
    logger.info(f"KAYA AI — DOCLING RAG INGESTION")
    logger.info(f"Source Directory: {doc_dir}")
    logger.info(f"Target Store:     {output_index_path}")
    logger.info(f"Embedding Model:  {embedding_model}")
    logger.info(f"Documents Found:  {len(doc_files)}")
    logger.info("=" * 60)

    # Load existing manifest for change tracking
    manifest_file = ROOT_DIR / manifest_path
    manifest_data: Dict[str, Any] = {"documents": {}, "last_updated": None}
    if manifest_file.exists() and not force:
        try:
            with open(manifest_file, "r", encoding="utf-8") as f:
                manifest_data = json.load(f)
        except Exception:
            pass

    all_chunks: List[Dict[str, Any]] = []
    processed_docs: Dict[str, Any] = {}

    for file_path in sorted(doc_files, key=lambda p: p.name):
        logger.info(f"\nProcessing: {file_path.name}")
        file_hash = compute_file_hash(file_path)

        # Parse with Docling
        try:
            chunks = parse_document_with_docling(file_path)
            all_chunks.extend(chunks)
            processed_docs[file_path.name] = {
                "file_hash": file_hash,
                "file_size": file_path.stat().st_size,
                "chunks_count": len(chunks),
                "ingested_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            }
        except Exception as e:
            logger.error(f"Failed to parse '{file_path.name}' with Docling: {e}")

    logger.info(f"\nGenerated total {len(all_chunks)} chunks across {len(processed_docs)} documents.")

    if not all_chunks:
        logger.warning("No chunks were generated. Aborting vector index creation.")
        return

    # Generate Embeddings via Gemini
    logger.info(f"\nGenerating Gemini embeddings ({embedding_model}) for {len(all_chunks)} chunks...")
    t_emb_start = time.perf_counter()
    texts = [c["text"] for c in all_chunks]
    embeddings = generate_embeddings_batch(
        client=client,
        model=embedding_model,
        texts=texts,
        batch_size=10,
    )
    t_emb_duration = time.perf_counter() - t_emb_start
    logger.info(f"Embeddings generated in {t_emb_duration:.2f}s ({len(embeddings)} vectors, dim={len(embeddings[0]) if embeddings else 0}).")

    # Attach embeddings to chunks
    for chunk_dict, emb in zip(all_chunks, embeddings):
        chunk_dict["embedding"] = emb

    # Build Vector Store Payload
    vector_store_payload = {
        "metadata": {
            "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "embedding_model": embedding_model,
            "document_count": len(processed_docs),
            "chunk_count": len(all_chunks),
            "source_dir": str(input_dir),
        },
        "documents": processed_docs,
        "chunks": all_chunks,
    }

    # Save to JSON index
    out_file = ROOT_DIR / output_index_path
    out_file.parent.mkdir(parents=True, exist_ok=True)
    with open(out_file, "w", encoding="utf-8") as f:
        json.dump(vector_store_payload, f, indent=2)

    logger.info(f"Successfully saved vector store to '{out_file}' ({out_file.stat().st_size / 1024:.1f} KB).")

    # Update Manifest
    manifest_data["docling_vector_store"] = {
        "index_path": output_index_path,
        "embedding_model": embedding_model,
        "document_count": len(processed_docs),
        "chunk_count": len(all_chunks),
        "last_updated": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }
    manifest_data["documents"] = processed_docs
    with open(manifest_file, "w", encoding="utf-8") as f:
        json.dump(manifest_data, f, indent=2)

    logger.info(f"Updated knowledge manifest at '{manifest_file}'.")

    # Print summary table
    print("\n" + "=" * 60)
    print("INGESTION SUMMARY")
    print("=" * 60)
    for doc_name, doc_meta in processed_docs.items():
        print(f" - {doc_name:<45} : {doc_meta['chunks_count']} chunks ({doc_meta['file_size']/1024:.1f} KB)")
    print("-" * 60)
    print(f"Total Documents: {len(processed_docs)}")
    print(f"Total Chunks:    {len(all_chunks)}")
    print(f"Vector Store:    {output_index_path}")
    print("=" * 60 + "\n")


def main():
    parser = argparse.ArgumentParser(description="Ingest safety documents using Docling & Gemini Embeddings.")
    parser.add_argument("--dir", default="pdfs_for_rag", help="Directory containing documents to ingest.")
    parser.add_argument("--out", default="knowledge/vector_store.json", help="Output path for vector store JSON.")
    parser.add_argument("--model", default="gemini-embedding-001", help="Gemini embedding model.")
    parser.add_argument("--force", action="store_true", help="Force re-ingestion of all documents.")
    args = parser.parse_args()

    run_ingestion(
        input_dir=args.dir,
        output_index_path=args.out,
        embedding_model=args.model,
        force=args.force,
    )



if __name__ == "__main__":
    main()
