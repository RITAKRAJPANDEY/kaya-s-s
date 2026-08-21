# 🏗️ Kaya 1.0 — Job Site Safety Copilot & Autonomous Multimodal Hub

> **Kaya** is an end-to-end, edge-accelerated computer vision and multimodal AI safety ecosystem built for high-risk industrial, manufacturing, and construction environments. 
> It pairs multi-model parallel neural inference (YOLO11 + YOLO-World + YOLO26 PPE + YOLO-Pose + Depth Anything V2) with an interactive, voice-enabled **Multimodal Vision Copilot** (Google Gemini, Sarvam AI, and Docling Structure-Aware RAG) and a **Next.js 16 Real-Time Operations Dashboard**.

---

## 📑 Table of Contents

- [System Architecture](#-system-architecture)
- [Core Subsystems & Capabilities](#-core-subsystems--capabilities)
  - [1. Real-Time Edge Vision Pipeline (Tier 1)](#1-real-time-edge-vision-pipeline-tier-1)
  - [2. Hazard, Gaze & Attention Reasoning (Tier 2)](#2-hazard-gaze--attention-reasoning-tier-2)
  - [3. Multimodal Voice + Vision + RAG Copilot (Tier 3)](#3-multimodal-voice--vision--rag-copilot-tier-3)
  - [4. Next.js 16 Web Dashboard & Spatial UI (Tier 4)](#4-nextjs-16-web-dashboard--spatial-ui-tier-4)
- [Parallel Execution & Hardware Acceleration](#-parallel-execution--hardware-acceleration)
- [Directory Layout](#-directory-layout)
- [Getting Started & Installation](#-getting-started--installation)
  - [Prerequisites](#prerequisites)
  - [Environment Configuration](#environment-configuration)
  - [One-Click Launcher](#one-click-launcher)
- [REST & WebSocket API Reference](#-rest--websocket-api-reference)
- [Frontend Page Overview](#-frontend-page-overview)
- [License & Credits](#-license--credits)

---

## 🏛️ System Architecture

```
                                    ┌────────────────────────────────────────────────────────┐
                                    │                 LIVE VIDEO INGESTION                   │
                                    │  Webcam (DirectShow) / RTSP / Pi 5 Stream / MP4 Files  │
                                    └───────────────────────────┬────────────────────────────┘
                                                                │
                                                                ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   TIER 1: MULTI-MODEL PARALLEL INFERENCE (THREAD POOL EXECUTOR)                                 │
│                                                                                                                                 │
│  ┌─────────────────────────┐   ┌─────────────────────────┐   ┌─────────────────────────┐   ┌─────────────────────────┐          │
│  │ YOLO11n General COCO    │   │ YOLO-World Open-Vocab   │   │ YOLO26 PPE Compliance   │   │ YOLO26-Pose (17 Pts)    │          │
│  │ Workers, Heavy Vehicles │   │ 125+ Construction Tools │   │ Hardhats, Vests, Masks  │   │ Body Angle, Yaw, Falls  │          │
│  └────────────┬────────────┘   └────────────┬────────────┘   └────────────┬────────────┘   └────────────┬────────────┘          │
│               │                             │                             │                             │                       │
│               └─────────────────────────────┼─────────────────────────────┴─────────────────────────────┘                       │
│                                             ▼                                                                                   │
│                                ┌─────────────────────────┐    ┌──────────────────────────────────────┐                          │
│                                │ ByteTrack Multi-Tracker │ ── │ Depth Anything V2 (Async Metric Map) │                          │
│                                └────────────┬────────────┘    └──────────────────┬───────────────────┘                          │
└─────────────────────────────────────────────┼────────────────────────────────────┼──────────────────────────────────────────────┘
                                              │                                    │
                                              ▼                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       TIER 2: SPATIAL SAFETY & ATTENTION REASONING ENGINE                                       │
│                                                                                                                                 │
│  - Metric Proximity & Hazard Zones (Warning < 3.0m, Critical < 1.5m)                                                            │
│  - Gaze & Attention Tracker (Head Yaw Vector vs Hazard Angle; 4s Unnoticed Escalation)                                          │
│  - Wrist-to-Tool Kinematic Linking (Tool Carrying State & Drop Alerts)                                                        │
│  - Fall & Immobility State Machine                                                                                              │
└─────────────────────────────────────────────┬───────────────────────────────────────────────────────────────────────────────────┘
                                              │
                                              ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                            COPILOT BRIDGE (backend/app/copilot_bridge.py)                                       │
│                                                                                                                                 │
│  - Real-Time MJPEG Multi-Mode Streamer (all / raw / pose / depth / ppe / objects)                                               │
│  - Rolling 1.0 FPS Temporal Ring Buffer (6-8s chronological context for Multimodal VLM analysis)                                │
│  - SQLite Audit Event Logger (data/events.db)                                                                                   │
└─────────────────────────────────────────────┬───────────────────────────────────────────────────────────────────────────────────┘
                                              │
                       ┌──────────────────────┴──────────────────────┐
                       ▼                                             ▼
┌──────────────────────────────────────────────┐ ┌────────────────────────────────────────────────────────────────────────────────┐
│   FASTAPI SERVER (:8001)                     │ │   NEXT.JS 16 DASHBOARD (:3001)                                                 │
│                                              │ │                                                                                │
│ - GET  /api/video_feed (MJPEG Stream)        │ │ - /vision: Live annotated video HUD, Three.js 3D Pose viewer, Voice Assistant  │
│ - GET  /api/status     (Active Metrics)      │ │ - /geofence: Dynamic Polygon Hazard Zones & Breach Triggers                    │
│ - GET  /api/pose       (3D Coordinates)      │ │ - /slam: 2D/3D Path & Trajectory Reconstruction                                │
│ - POST /api/ask        (Voice STT -> VLM)    │ │ - /phone: Mobile Device IMU Telemetry Streamer (Gyro/Accel/GPS)                │
│ - POST /api/ask-text   (Text -> VLM -> TTS)  │ │ - /reports: OSHA Incident Audits & Safety Compliance Analytics                 │
│ - POST /api/search-docs(Docling RAG Search)  │ │ - /: Central Telemetry & Live Multi-Device Hub                                 │
└──────────────────────────────────────────────┘ └────────────────────────────────────────────────────────────────────────────────┘
```

---

## ⚡ Core Subsystems & Capabilities

### 1. Real-Time Edge Vision Pipeline (Tier 1)
- **General COCO Detection (`YOLO11n`)**: Rapidly identifies site workers, forklifts, trucks, cranes, and 80 COCO base classes.
- **Open-Vocabulary Tool Scanner (`YOLO-World v2`)**: Zero-shot detection over **125+ specialized tools and hazard classes** (e.g. angle grinders, jackhammers, welding torches, ladders, gas cylinders, rebar, open manholes).
- **PPE Compliance Monitor (`YOLO26 PPE`)**: Classifies site personnel for Hardhat, Safety Vest, Mask, and flags violations (`NO-Hardhat`, `NO-Safety Vest`).
- **17-Keypoint Skeletal Estimator (`YOLO26-Pose`)**: Tracks worker posture, calculates head yaw angles, detects ergonomic strain, and flags catastrophic worker falls.
- **Monocular Metric Depth (`Depth Anything V2`)**: Computes exact physical distance (in meters) to every tracked bounding box and keypoint without requiring stereo rigs or LiDAR sensors.

### 2. Hazard, Gaze & Attention Reasoning (Tier 2)
- **Attention Tracking & Dwell Escalation**: Estimates whether a worker's head yaw bearing intersects with approaching equipment or danger zones. If a worker has not looked at an incoming hazard for 4+ seconds, the hazard severity is dynamically escalated.
- **Wrist-to-Tool Kinematic Association**: Connects detected tool bounding boxes to nearest wrist keypoints to identify active tool usage and dropped equipment.
- **Proximity Ring Calculations**: Classifies worker distance into **Safe (> 3.0m)**, **Warning (1.5m - 3.0m)**, and **Critical Danger (< 1.5m)** zones.

### 3. Multimodal Voice + Vision + RAG Copilot (Tier 3)
- **Vision Reasoner**: Powered by **Google Gemini 3.1 Flash Lite** / **Gemini 3.5 Flash** (with support for NVIDIA NIM `meta/llama-3.2-11b-vision-instruct`).
- **Rolling Temporal Ring Buffer**: Maintains a chronological sequence of the past 6-8 seconds of frames at 1.0 FPS, enabling the VLM to answer temporal questions (*"What just fell on the left?"*, *"Did that forklift operator stop at the intersection?"*).
- **Speech-to-Text & Text-to-Speech**: Powered by **Sarvam AI** (`saaras:v3` STT & `bulbul:v3/shubh` TTS) with local failover.
- **Docling Structure-Aware RAG**: Integrates vectorized site manuals and safety policies from `pdfs_for_rag/` with Gemini embeddings (`gemini-embedding-001`).

### 4. Next.js 16 Web Dashboard & Spatial UI (Tier 4)
- **Turbopack-accelerated Next.js 16** with Tailwind CSS and Three.js.
- **Live Multi-Mode Video Feed**: Real-time switching between Full Annotated Overlay, Raw Feed, 2D Pose Skeleton, Metric Depth Map, PPE Inspection, and Tool Scanner.
- **Interactive Three.js 3D Pose Viewer**: Renders true 3D skeletal joints mapped with real-time metric depth coordinates.
- **Push-to-Talk HUD & Chat**: Real-time voice interaction with latency waterfall metrics (`STT: 120ms | VLM: 950ms | TTS: 410ms`).

---

## 🚀 Parallel Execution & Hardware Acceleration

| Component | Technology | Execution Model |
| :--- | :--- | :--- |
| **Video Ingestion** | OpenCV `cv2.CAP_DSHOW` (Windows) / V4L2 | Dedicated thread, non-blocking frame buffer |
| **General + Tracking** | YOLO11n + ByteTrack | Main worker thread |
| **PPE Inspection** | YOLO26 PPE | Concurrent worker thread (`ThreadPoolExecutor`) |
| **Tool Scanning** | YOLO-World v2 | Concurrent worker thread (`ThreadPoolExecutor`) |
| **Pose Estimation** | YOLO26-Pose (17 Keypoints) | Concurrent worker thread (`ThreadPoolExecutor`) |
| **Monocular Depth** | Depth Anything V2 Small | Async worker thread (non-blocking, zero frame drop) |
| **Device Dispatcher** | PyTorch CUDA / MPS / CPU Auto-Discovery | Automated kernel smoke-testing with zero-crash fallback |

---

## 📁 Directory Layout

```
Kaya-final-1.0/
├── start.bat                   # One-Click Launcher for both Frontend & Backend
├── README.md                   # Complete system documentation (this file)
│
├── backend/                    # Python AI & Computer Vision Backend
│   ├── main.py                 # Unified Safety Copilot & FastAPI startup entry
│   ├── config.yaml             # Computer vision thresholds & model configs
│   ├── requirements.txt        # Python dependencies
│   ├── core/                   # Real-time CV engine modules
│   │   ├── capture.py          # DirectShow/Webcam/RTSP frame grabber
│   │   ├── detector.py         # Multi-model YOLO11, YOLO-World, PPE inference
│   │   ├── depth_estimator.py  # Depth Anything V2 metric depth pipeline
│   │   ├── pose_estimator.py   # 17-keypoint pose & head yaw calculation
│   │   ├── device.py           # Hardware device auto-detection & smoke test
│   │   └── models.py           # Dataclasses (Detection, TrackedObject, FrameResult)
│   ├── safety/                 # Safety rule engines
│   │   ├── hazard_analyzer.py  # Distance calculation & danger zones
│   │   ├── attention_tracker.py# Worker gaze tracking & dwell escalation
│   │   └── ppe_checker.py      # PPE compliance verification
│   ├── app/                    # FastAPI Server & Copilot Bridge
│   │   ├── main.py             # REST & streaming endpoints
│   │   ├── copilot_bridge.py   # MJPEG generator & temporal ring buffer
│   │   └── pipeline.py         # STT -> VLM -> TTS multimodal pipeline
│   ├── kaya/                   # Multimodal Reasoners & RAG Providers
│   │   ├── factory.py          # Dynamic provider instantiator
│   │   └── providers/          # Gemini, Sarvam, Docling vector store implementations
│   └── data/                   # SQLite event log database (events.db)
│
└── frontend/                   # Next.js 16 React Dashboard
    ├── package.json            # Node.js dependencies
    ├── next.config.ts          # Next.js configuration
    └── src/
        └── app/
            ├── page.tsx        # Central Telemetry & Live Device Hub
            ├── vision/         # Live Vision Copilot, 3D Pose & Voice Assistant
            ├── geofence/       # Interactive Hazard Geofencing Polygon Canvas
            ├── slam/           # 2D/3D Trajectory Reconstruction
            ├── phone/          # Mobile Phone IMU Telemetry Streamer
            └── reports/        # Safety Compliance & Incident Audit Logs
```

---

## 🛠️ Getting Started & Installation

### Prerequisites
- **Operating System**: Windows 10/11, macOS (Apple Silicon), or Ubuntu 22.04+
- **Python**: 3.10 to 3.12 (Python 3.11 recommended)
- **Node.js**: v18.18+ or v20+
- **Camera**: Integrated Webcam, USB Camera, or RTSP/Pi 5 IP stream

---

### Environment Configuration

Create a `.env` file in the `backend/` directory:

```ini
# --- Multimodal Reasoners ---
VISION_PROVIDER=gemini
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-3.1-flash-lite

# --- Speech Services ---
STT_PROVIDER=sarvam
TTS_PROVIDER=sarvam
SARVAM_API_KEY=your_sarvam_api_key_here

# --- Temporal Frame Buffer ---
FRAME_MODE=TEMPORAL_FRAMES
TEMPORAL_BUFFER_SECONDS=6.0
TEMPORAL_FPS=1.0
TEMPORAL_MAX_FRAMES=8

# --- RAG & Knowledge Retrieval ---
RAG_PROVIDER=docling
EMBEDDING_MODEL=gemini-embedding-001
```

---

### One-Click Launcher

To launch both the Next.js Frontend and the Python AI Backend simultaneously:

```cmd
:: On Windows:
start.bat
```

Or start the services individually:

#### 1. Start Python Backend (Port 8001)
```bash
cd backend
python -m venv .venv
# Windows:
.venv\Scripts\activate
# Linux/macOS:
source .venv/bin/activate

pip install -r requirements.txt
python -u main.py --no-display
```

#### 2. Start Next.js Frontend (Port 3001)
```bash
cd frontend
npm install
npm run dev -- -p 3001
```

Once started, open your browser to **`http://localhost:3001/vision`**.

---

## 📡 REST & WebSocket API Reference

The backend exposes a high-throughput REST API on port `8001`:

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/video_feed` | `GET` | Live multipart MJPEG video stream. Query params: `?mode=all\|raw\|pose\|depth\|ppe\|objects` |
| `/api/status` | `GET` | Live status JSON: Copilot active flag, FPS, tracked objects count, active hazards, and latency metrics |
| `/api/pose` | `GET` | Real-time 3D keypoints (`x, y, depth, confidence`) for all tracked persons + head yaw angles |
| `/api/ask` | `POST` | Push-to-Talk audio endpoint: Transcribes speech (STT), samples temporal frames, executes VLM, returns answer + base64 TTS audio |
| `/api/ask-text` | `POST` | Text query endpoint: Evaluates temporal video frames against text prompt with Gemini VLM |
| `/api/documents` | `GET` | Lists indexed safety manuals and standard operating procedures (SOPs) |
| `/api/search-docs` | `POST` | Performs semantic similarity search against vectorized Docling knowledge store |

---

## 🖥️ Frontend Page Overview

| Route | Page Name | Primary Functionality |
| :--- | :--- | :--- |
| **`/vision`** | **Safety Copilot Hub** | Live annotated video HUD, Three.js 3D skeleton visualizer, Push-to-Talk voice interface, and multi-view layer switcher |
| **`/geofence`** | **Dynamic Geofencing** | Polygon boundary creator for marking heavy machinery zones, high-voltage areas, and intrusion alarms |
| **`/slam`** | **Spatial SLAM Map** | Real-time worker trajectory mapping, spatial positioning, and historical movement replay |
| **`/phone`** | **Mobile Sensor Streamer**| Connects mobile smartphones as wearable telemetry nodes streaming accelerometer, gyro, and GPS metrics |
| **`/reports`** | **Safety & Incident Log** | OSHA compliance audit trail, exportable violation records, and incident severity logs |
| **`/`** | **Operations Dashboard** | Central operational overview across all connected telemetry sensors and video streams |

---

## 👥 License & Credits

Developed with ❤️ for the **Kaya Hackathon** by **Team Antigravity**.  
Powered by Ultralytics YOLO, Depth Anything V2, Google Gemini, Sarvam AI, and Next.js.
