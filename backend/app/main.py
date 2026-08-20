"""FastAPI REST API server for Kaya Voice + Vision Assistant with Live YOLO Copilot Stream & Docling RAG."""

import logging
import os
from contextlib import asynccontextmanager
from typing import List, Optional

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from app.config import get_settings
from app.copilot_bridge import copilot_bridge
from app.pipeline import KayaPipeline

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("kaya.main")

settings = get_settings()
pipeline = KayaPipeline(settings=settings)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing Kaya Voice + Vision + RAG Assistant...")
    logger.info(f"STT Provider:        {pipeline.stt_provider.name}")
    logger.info(f"Vision Reasoner:     {pipeline.vision_reasoner.name} ({pipeline.vision_reasoner.model_name})")
    logger.info(f"TTS Provider:        {pipeline.tts_provider.name}")
    logger.info(f"Knowledge Retriever: {pipeline.knowledge_retriever.name if pipeline.knowledge_retriever else 'none'}")
    logger.info(f"Frame Mode:          {settings.frame_mode} (Buffer: {settings.temporal_buffer_seconds}s @ {settings.temporal_fps} FPS, Max: {settings.temporal_max_frames} frames)")

    # If SafetyCopilot is not already running (e.g. if started via uvicorn directly), start background worker
    if not copilot_bridge._running:
        try:
            copilot_bridge.start_background_copilot(source=0)
        except Exception as e:
            logger.warning(f"Could not start background SafetyCopilot: {e}")

    yield

    logger.info("Shutting down Kaya...")
    copilot_bridge.stop()


app = FastAPI(
    title="Kaya - Safety Copilot & Voice+Vision Assistant",
    version="0.4.0",
    lifespan=lifespan
)

# CORS restricted to localhost origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        f"http://127.0.0.1:{settings.port}",
        f"http://localhost:{settings.port}",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001"
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.middleware("http")
async def security_headers_middleware(request: Request, call_next):
    """Add standard security headers."""
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response


# Static file mount
static_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static")
if os.path.exists(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")


@app.get("/")
async def serve_index():
    """Serve the single-page application UI."""
    index_file = os.path.join(static_dir, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file)
    return JSONResponse({"message": "Kaya Backend API is running."})


@app.get("/api/video_feed")
async def video_feed(mode: str = "all"):
    """Stream real-time Safety Copilot video frames in the requested view mode (all, raw, pose, depth, ppe, objects)."""
    return StreamingResponse(
        copilot_bridge.get_video_frame_stream(mode=mode),
        media_type="multipart/x-mixed-replace; boundary=frame"
    )


@app.get("/api/pose")
async def get_pose_data():
    """Return latest pose keypoints and depth map as JSON for the 3D pose viewer."""
    return copilot_bridge.get_latest_pose_data()


@app.get("/api/status")
async def get_status():
    """Get system health, provider metadata, copilot metrics, RAG settings, and temporal buffer settings."""
    current_settings = get_settings()
    copilot_info = copilot_bridge.get_status()

    rag_ready = False
    rag_info = {}
    if pipeline.knowledge_retriever:
        rag_ready = await pipeline.knowledge_retriever.is_ready()
        rag_info = await pipeline.knowledge_retriever.get_store_info()

    return {
        "status": "ready",
        "providers": {
            "stt": pipeline.stt_provider.name,
            "vision": f"{pipeline.vision_reasoner.name}:{pipeline.vision_reasoner.model_name}",
            "tts": pipeline.tts_provider.name,
            "rag": pipeline.knowledge_retriever.name if pipeline.knowledge_retriever else "none",
        },
        "copilot": copilot_info,
        "rag": {
            "enabled": current_settings.rag_enabled,
            "ready": rag_ready,
            "provider": pipeline.knowledge_retriever.name if pipeline.knowledge_retriever else "none",
            "router_mode": current_settings.rag_router_mode,
            "store_name": pipeline.knowledge_retriever.get_file_search_store_name() if pipeline.knowledge_retriever else None,
            "document_count": rag_info.get("document_count", 0),
            "documents": rag_info.get("documents", []),
            "message": rag_info.get("message", "RAG is not active."),
        },
        "config": {
            "gemini_configured": bool(current_settings.gemini_api_key and not current_settings.gemini_api_key.startswith("your_")),
            "sarvam_configured": bool(current_settings.sarvam_api_key and not current_settings.sarvam_api_key.startswith("your_")),
            "nvidia_configured": bool(current_settings.nvidia_api_key and not current_settings.nvidia_api_key.startswith("your_")),
            "vision_provider": current_settings.vision_provider,
            "stt_provider": current_settings.stt_provider,
            "tts_provider": current_settings.tts_provider,
            "rag_provider": current_settings.rag_provider,
            "gemini_model": current_settings.gemini_model,
            "nvidia_model": current_settings.nvidia_model,
            "frame_mode": current_settings.frame_mode,
            "temporal_buffer_seconds": current_settings.temporal_buffer_seconds,
            "temporal_fps": current_settings.temporal_fps,
            "temporal_max_frames": current_settings.temporal_max_frames,
        },
        "history_turns": len(pipeline.get_history()) // 2
    }


@app.get("/api/knowledge/status")
async def get_knowledge_status():
    """Get detailed knowledge base and indexed document information."""
    if not pipeline.knowledge_retriever:
        return {
            "enabled": False,
            "ready": False,
            "message": "Knowledge retrieval layer is disabled in settings.",
            "documents": [],
            "document_count": 0,
        }

    ready = await pipeline.knowledge_retriever.is_ready()
    info = await pipeline.knowledge_retriever.get_store_info()
    return {
        "enabled": True,
        "ready": ready,
        "provider": pipeline.knowledge_retriever.name,
        "store_name": pipeline.knowledge_retriever.get_file_search_store_name(),
        "document_count": info.get("document_count", 0),
        "documents": info.get("documents", []),
        "message": info.get("message", ""),
    }


@app.post("/api/reset")
async def reset_history():
    """Reset conversational context history."""
    pipeline.reset_history()
    return {"status": "ok", "message": "Conversation history cleared."}


@app.post("/api/ask")
async def ask_kaya(
    audio: UploadFile = File(..., description="Microphone speech audio file"),
    images: Optional[List[UploadFile]] = File(None, description="Temporal sequence of camera frames"),
    image: Optional[UploadFile] = File(None, description="Single fallback camera frame"),
    frame_mode: Optional[str] = Form(None, description="Optional override for SINGLE_FRAME or TEMPORAL_FRAMES"),
):
    """Process a voice + vision query turn."""
    MAX_FILE_SIZE = 15 * 1024 * 1024

    try:
        audio_bytes = await audio.read()
        if len(audio_bytes) > MAX_FILE_SIZE:
            raise HTTPException(status_code=400, detail="Audio file exceeds 15MB size limit.")

        parsed_frames = []
        upload_files = []
        if images and len(images) > 0:
            upload_files.extend(images)
        if image:
            upload_files.append(image)

        for f in upload_files:
            b = await f.read()
            if b:
                if len(b) > MAX_FILE_SIZE:
                    raise HTTPException(status_code=400, detail="An image frame exceeds 15MB size limit.")
                parsed_frames.append((b, f.content_type or "image/jpeg"))

        # Fallback to live copilot bridge temporal frames if no client images uploaded
        if not parsed_frames:
            parsed_frames = copilot_bridge.get_latest_temporal_frames(max_frames=settings.temporal_max_frames)

        if not parsed_frames:
            raise HTTPException(status_code=400, detail="No readable camera frame images available.")

        result = await pipeline.process_turn(
            audio_bytes=audio_bytes,
            audio_mime=audio.content_type or "audio/wav",
            images=parsed_frames,
            frame_mode=frame_mode
        )
        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error processing voice+vision query")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/ask-text")
async def ask_kaya_text(
    question: str = Form(..., description="Direct text question"),
    images: Optional[List[UploadFile]] = File(None, description="Temporal sequence of camera frames"),
    image: Optional[UploadFile] = File(None, description="Single fallback camera frame"),
    frame_mode: Optional[str] = Form(None, description="Optional override for SINGLE_FRAME or TEMPORAL_FRAMES"),
):
    """Process a text + vision query turn."""
    MAX_FILE_SIZE = 15 * 1024 * 1024

    try:
        parsed_frames = []
        upload_files = []
        if images and len(images) > 0:
            upload_files.extend(images)
        if image:
            upload_files.append(image)

        for f in upload_files:
            b = await f.read()
            if b:
                if len(b) > MAX_FILE_SIZE:
                    raise HTTPException(status_code=400, detail="An image frame exceeds 15MB size limit.")
                parsed_frames.append((b, f.content_type or "image/jpeg"))

        # Fallback to live copilot bridge temporal frames if no client images uploaded
        if not parsed_frames:
            parsed_frames = copilot_bridge.get_latest_temporal_frames(max_frames=settings.temporal_max_frames)

        if not parsed_frames:
            raise HTTPException(status_code=400, detail="No readable camera frame images available.")

        result = await pipeline.process_turn(
            direct_question=question,
            images=parsed_frames,
            frame_mode=frame_mode
        )
        return result

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error processing text+vision query")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=True
    )
