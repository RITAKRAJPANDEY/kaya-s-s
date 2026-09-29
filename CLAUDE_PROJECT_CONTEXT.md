# Kaya AI Platform — Complete Project Context for Claude

This document serves as a comprehensive overview of the **Kaya AI Platform**, a real-time, edge-accelerated computer vision and multimodal AI safety ecosystem designed for high-risk industrial environments. Use this context to understand the system architecture, file structure, technology stack, and how different subsystems interact.

---

## 1. Project Overview

**Kaya** acts as a Job Site Safety Copilot and Autonomous Multimodal Hub. It ingests live video streams, applies multiple AI models (YOLO variants and Depth estimation) to detect hazards, tracks PPE compliance and worker falls, and serves a live web dashboard.

Additionally, it integrates a **Multimodal Voice + Vision + RAG Copilot** powered by Google Gemini and Sarvam AI, allowing operators to converse with the system about real-time video events and search vectorized safety manuals using Docling.

---

## 2. Technology Stack

### Backend (Python / AI Vision Node)
- **Framework**: FastAPI (runs on port `8001`), Uvicorn.
- **Computer Vision Pipeline**: OpenCV, PyTorch, Ultralytics YOLO26 / YOLO11 / YOLO-World v2 (for general objects, PPE, Pose, and open-vocabulary tool scanning).
- **Depth Estimation**: Depth Anything V2 / MiDaS.
- **Multimodal AI**: `google-genai` (Gemini 3.1 Flash), Sarvam AI (for STT/TTS).
- **RAG & Knowledge Retrieval**: Docling (structure-aware document parsing) + Gemini embeddings.
- **Databases**: SQLite (`events.db`) for incident logging.
- **Concurrency**: `ThreadPoolExecutor` for parallel model inference.

### Frontend (Next.js / Dashboard)
- **Framework**: Next.js 16 (App Router), React 19 (runs on port `3001`).
- **Styling**: Tailwind CSS v4, Lucide React (Icons).
- **3D & Visualization**: Three.js (`three`) for interactive 3D skeletal posture rendering.
- **Mapping & Geofencing**: Leaflet (`leaflet`) for dynamic 2D polygons and real-time GPS tracking using Kalman filtering.
- **Communication**: Server-Sent Events (SSE) for low-latency telemetry updates, REST for fetching frames (`/api/video_feed`).

---

## 3. System Architecture & Data Flow

The project is split into two independent services that run concurrently and communicate via HTTP REST, WebSocket, and SSE.

### Data Flow Diagram

```text
[Video Sources: Webcam / RTSP / MP4] 
        │
        ▼ (OpenCV)
┌────────────────────────────────────────────────────────┐
│ BACKEND: TIER 1 VISION PIPELINE (Python / FastAPI)     │
│ - YOLO11n (COCO base classes)                          │
│ - YOLO-World v2 (125+ construction tools)              │
│ - YOLO26 PPE (Hardhat, Vest, Mask)                     │
│ - YOLO26-Pose (17 Keypoints, Head Yaw)                 │
│ - Depth Anything V2 (Metric Depth)                     │
└───────────────────────┬────────────────────────────────┘
                        │ (Bounding Boxes, Keypoints, Depth)
                        ▼
┌────────────────────────────────────────────────────────┐
│ BACKEND: TIER 2 SAFETY ENGINE & COPILOT BRIDGE         │
│ - hazard_analyzer.py, ppe_checker.py, fall_detector.py │
│ - Maintains an 8-sec rolling temporal frame buffer     │
│ - copilot_bridge.py streams MJPEG & JSON to frontend   │
└───────────────────────┬────────────────────────────────┘
    (REST: /api/video_feed, /api/pose, /api/ask)
                        │
                        ▼
┌────────────────────────────────────────────────────────┐
│ FRONTEND: NEXT.JS 16 DASHBOARD (React / Tailwind)      │
│ - /vision: Live MJPEG overlay, Three.js 3D Skeleton,   │
│            Push-to-Talk AI Chatbot (Gemini + Sarvam)   │
│ - /geofence: Leaflet Map + Kalman Filtered Telemetry   │
│ - /phone: Mobile GPS + IMU Streamer -> /api/telemetry  │
└────────────────────────────────────────────────────────┘
```

---

## 4. Directory Structure Deep Dive

### `backend/` (FastAPI + PyTorch)
- **`main.py`**: The main entry point. Sets up the FastAPI application and initializes the Vision pipeline.
- **`config.yaml`**: Contains AI confidence thresholds, class definitions, and active models.
- **`core/`**: The core vision engine.
  - `capture.py`: Frame ingestion (webcam, RTSP, mp4).
  - `detector.py`: Multi-model YOLO execution.
  - `pose_estimator.py`: Skeleton & head yaw estimation.
  - `depth_estimator.py`: Depth mapping.
- **`safety/`**: Rule engines that consume data from `core/`.
  - `ppe_checker.py`, `fall_detector.py`, `zones.py`, `attention_tracker.py`.
- **`app/`**: Web routing and AI interaction.
  - `copilot_bridge.py`: Manages the MJPEG stream and temporal ring buffer for the VLM.
  - `pipeline.py`: Orchestrates Voice (STT) -> Reasoning (Gemini) -> Voice (TTS) loop.
  - `providers/`: Integration wrappers for Gemini, Sarvam, and Docling.
- **`logging_/`**: Incident auditing and SQLite integration.

### `frontend/` (Next.js 16)
- **`src/app/`**: Next.js App Router endpoints.
  - **`/vision`**: The Safety Copilot view. Displays live video overlay, Three.js 3D pose, and the AI chatbot interface.
  - **`/geofence`**: Map dashboard. Plots live worker coordinates, machinery locations, and user-drawn polygon danger zones.
  - **`/phone`**: A mobile web page that captures phone IMU (gyro/accel) and GPS data, streaming it back to the hub.
  - **`/slam`**: A UI for 2D/3D robot mapping (currently simulated via client-side jitter).
  - **`/reports`**: Contains OSHA incident audits and the WorksiteGuard multi-camera mesh UI (currently unconnected by default).
  - **`/api/telemetry/*`**: Next.js API routes that receive and broadcast telemetry data using SSE.
- **`src/lib/`**:
  - `telemetryStore.ts`: In-memory state for active telemetry devices (drones, phones).
  - `kalman.ts` & `geo.ts`: Calculations for smoothing noisy GPS signals.

---

## 5. Active and Disconnected Pipelines

To understand the current deployment state:
1. **LIVE (Mounted)**: 
   - YOLO Vision Pipeline -> `/vision` frontend (via `/api/video_feed`).
   - Voice + RAG AI Assistant -> `/vision` chat panel (via `/api/ask`).
   - Mobile Broadcaster (`/phone`) -> `/geofence` Map (via SSE `/api/telemetry`).
2. **UNMOUNTED/MOCK (Disconnected)**:
   - **WorksiteGuard Mesh** (`yolo/worksite-guard/.../server/main.py`): Runs on port 8000 but the frontend `/reports` view might not fully connect to it unless configured.
   - **SLAM Odometry**: The `/slam` page relies on a mocked `setInterval` simulator, as there is no backend hardware pipeline feeding live LiDAR.
   - **Incident SQLite DB**: `backend/logging_/event_logger.py` writes to `events.db`, but the frontend currently lacks a REST endpoint to query and display these logs on the `/reports` page.

---

## 6. How to Run

A batch file `start.bat` exists in the root to launch the environments automatically:
```bat
start.bat
```
This executes:
1. The Next.js frontend (`npm run dev -- -p 3001`).
2. The Python backend (`python -u main.py --no-display` on port 8001).
3. The WorksiteGuard server (on port 8000).

*Ensure the `.env` file is present in `backend/` with `GEMINI_API_KEY` and `SARVAM_API_KEY` to enable the Copilot features.*
