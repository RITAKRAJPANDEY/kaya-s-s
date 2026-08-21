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


_rag_cache: dict = {"ts": 0.0, "ready": False, "info": {}}


@app.get("/api/status")
async def get_status():
    """Get system health, provider metadata, copilot metrics, RAG settings, and temporal buffer settings."""
    current_settings = get_settings()
    copilot_info = copilot_bridge.get_status()

    global _rag_cache
    now = time.time() if "time" in globals() else 0.0
    import time as _t
    now = _t.time()

    if now - _rag_cache["ts"] > 30.0:
        rag_ready = False
        rag_info = {}
        if pipeline.knowledge_retriever:
            try:
                rag_ready = await asyncio.wait_for(pipeline.knowledge_retriever.is_ready(), timeout=1.0)
                rag_info = await asyncio.wait_for(pipeline.knowledge_retriever.get_store_info(), timeout=1.0)
            except Exception:
                rag_ready = False
                rag_info = {}
        _rag_cache = {"ts": now, "ready": rag_ready, "info": rag_info}
    else:
        rag_ready = _rag_cache["ready"]
        rag_info = _rag_cache["info"]

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
            "message": rag_info.get("message", "RAG is ready."),
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


# ─── MUSt3R 3D SLAM & RECONSTRUCTION ENDPOINTS ───────────────────
from app.slam_service import slam_service


@app.get("/api/slam/datasets")
async def get_slam_datasets():
    """List all available image sequence folders and video recordings for SLAM mapping."""
    return {"datasets": slam_service.list_datasets(), "checkpoints": slam_service.list_checkpoints()}


@app.post("/api/slam/extract-frames")
async def extract_slam_video_frames(
    video_path: str = Form(...),
    fps: int = Form(5),
    output_dir: Optional[str] = Form(None)
):
    """Extract JPEG frames from video using FFmpeg."""
    try:
        return slam_service.extract_frames(video_path=video_path, fps=fps, output_dir=output_dir)
    except Exception as e:
        logger.exception("Failed to extract video frames")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/slam/viser-studio")
async def launch_viser_studio():
    """Launch official MUSt3R Viser + Gradio 3D Studio demo in background."""
    try:
        return slam_service.launch_viser_studio()
    except Exception as e:
        logger.exception("Failed to launch Viser Studio")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/slam/reconstruct")
async def start_slam_reconstruction(
    dataset_id: str = Form("frames_demo2"),
    custom_path: Optional[str] = Form(None),
    execution_mode: str = Form("linseq"),
    resolution: int = Form(512),
    subsample: int = Form(2),
    checkpoint: str = Form("MUSt3R_512.pth")
):
    """Start an asynchronous MUSt3R 3D reconstruction and camera tracking pipeline."""
    try:
        return slam_service.start_reconstruction(
            dataset_id=dataset_id,
            custom_path=custom_path,
            execution_mode=execution_mode,
            resolution=resolution,
            subsample=subsample,
            checkpoint_name=checkpoint
        )
    except Exception as e:
        logger.exception("Failed to start SLAM reconstruction")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/slam/status")
async def get_slam_status():
    """Poll status and progress of current reconstruction job."""
    return slam_service.get_status()


@app.post("/api/slam/cancel")
async def cancel_slam_job():
    """Cancel any active reconstruction process."""
    return slam_service.cancel_job()


@app.get("/api/slam/scene")
async def get_slam_scene(
    dataset_id: Optional[str] = None,
    custom_ply_path: Optional[str] = None
):
    """Retrieve 3D point cloud data and 6-DoF camera trajectory poses."""
    return slam_service.get_scene_data(dataset_id=dataset_id, custom_ply_path=custom_ply_path)



if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        reload=True
    )
