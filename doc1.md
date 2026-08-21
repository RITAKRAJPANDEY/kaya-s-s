# KAYA AI SAFETY PLATFORM — COMPLETE SYSTEM ARCHITECTURE & PIPELINE DIAGNOSTIC REPORT (doc1.md)

**Generated:** August 21, 2026  
**Version:** Kaya AI Copilot v1.0 / Architecture Audit  

---

## 1. Executive Diagnostic Summary

This document details all hardware, software, AI inference, and telemetry pipelines across the Kaya repository, mapping how files and subsystems connect, and highlighting **which pipelines are mounted to the Next.js frontend versus which are unmounted or running in mock/isolated modes**.

### Pipeline Connection Status Matrix

| Subsystem / Pipeline | Backend Source Files | Target Port / Protocol | Frontend Page / Component | Connection Status |
| :--- | :--- | :--- | :--- | :--- |
| **Live YOLO Safety Copilot** (PPE, Fall, Pose, Depth, Zones) | `backend/main.py`<br>`backend/core/*`<br>`backend/safety/*` | `8001` HTTP MJPEG<br>`/api/video_feed`<br>`/api/pose` | `frontend/src/app/vision/page.tsx` (`/vision`) | 🟢 **MOUNTED & LIVE** |
| **Voice + Vision + RAG Assistant** (STT, TTS, Docling RAG) | `backend/app/main.py`<br>`backend/app/pipeline.py`<br>`backend/app/providers/*` | `8001` REST API<br>`/api/ask`<br>`/api/ask-text` | `frontend/src/app/vision/page.tsx`<br>`CopilotChatPanel.tsx` | 🟢 **MOUNTED & LIVE** |
| **Multi-Device GPS & Kalman Geofencing** | `frontend/src/lib/telemetryStore.ts`<br>`frontend/src/lib/kalman.ts`<br>`frontend/src/lib/geo.ts` | `3001` Next.js SSE<br>`/api/telemetry`<br>`/api/telemetry/stream` | `frontend/src/app/geofence/page.tsx` (`/geofence`)<br>`LiveMap.tsx` | 🟢 **MOUNTED & LIVE** |
| **Mobile Broadcaster (Phone GPS + IMU)** | `frontend/src/app/phone/page.tsx` | `3001` HTTP POST<br>`/api/telemetry` | `frontend/src/app/phone/page.tsx` (`/phone`) | 🟢 **MOUNTED & LIVE** |
| **WorksiteGuard YOLO Camera Mesh** | `frontend/yolo/worksite-guard/worksite-guard/server/main.py` | `8000` WebSocket<br>`/ws/dashboard`<br>`/ws/client` | `frontend/src/app/reports/page.tsx`<br>`WorksiteGuardDashboard.tsx` | 🔴 **NOT MOUNTED (Server Port 8000 not started in start.bat)** |
| **SLAM Odometry & LiDAR Mapping** | *None in backend* | *None* | `frontend/src/app/slam/page.tsx`<br>`SlamTelemetry.tsx` | 🟡 **NOT MOUNTED (Client-side Mock Simulation)** |
| **Historical Safety Incident DB** | `backend/logging_/event_logger.py`<br>`backend/data/events.db` | SQLite File | `frontend/src/components/IncidentAnalysisModal.tsx` | 🔴 **NOT MOUNTED (No REST query endpoint exposed for SQLite)** |
| **Raspberry Pi Video Streamer** | `backend/pi_stream/stream_server.py` | `8080` HTTP MJPEG<br>`/stream` | Feeds into `backend/main.py` (`FrameSource`) | ⚪ **HARDWARE-ONLY (Runs on external Pi board)** |
| **Legacy Prototype Server** | `frontend/server.py`<br>`frontend/run.py` | `8000` FastAPI WS | `frontend/phone.html`<br>`frontend/map.html` | ⚪ **SUPERSEDED (Replaced by Next.js routes)** |

---

## 2. System Architecture & Data Flow Diagram

```
                                    +-------------------------------------------------------------+
                                    |                     KAYA FRONTEND (Port 3001)               |
                                    |                       Next.js 16 + React 19                 |
                                    +-------------------------------------------------------------+
                                      |                   |                   |                 |
                +---------------------+                   |                   |                 +----------------------+
                |                                         |                   |                                        |
        [ /vision page ]                          [ /geofence page ]   [ /reports page ]                        [ /phone page ]
   - Live MJPEG stream display               - Interactive Leaflet Map - Camera mesh dashboard             - Web Geolocation GPS
   - 3D Keypoint skeleton (Three.js)         - 2D/3D Kalman filter     - Incident case study                - DeviceOrientation IMU
   - Voice/Text AI Copilot panel             - Dynamic Polygon zones   - Blind-spot alerts                  - Posture & Heading
                |                                         |                   |                                        |
                | (HTTP / REST / MJPEG)                   | (Next.js SSE)     | (WebSocket)                            | (HTTP POST)
                v                                         v                   v                                        v
+--------------------------------+          +-----------------------+   +------------------------+          +--------------------+
|   KAYA AI BACKEND (Port 8001)  |          | NEXT.JS IN-MEMORY HUB |   | WORKSITE-GUARD (8000)  |          | /api/telemetry     |
|   FastAPI + OpenCV + PyTorch   |          |  lib/telemetryStore   |   |   FastAPI WebSockets   |          |   (Next.js Route)  |
+--------------------------------+          +-----------------------+   +------------------------+          +--------------------+
| • FrameSource (Webcam / RTSP)  |          | • Real-time broadcast |   | • Client camera frames |                   ^
| • YOLO26 Object Detection      |          | • Blind-spot engine   |   | • Multi-camera mesh    |                   |
| • YOLO26-Pose Estimation       |          | • FOV calculation     |   | • Threat arbitration   |                   |
| • MiDaS / Depth Anything       |          +-----------------------+   +------------------------+                   |
| • Safety: PPE, Fall, Dwell     |                      ^                            ^                               |
| • Docling RAG + Vector DB      |                      |                            |                               |
| • STT / TTS / Gemini Reasoning |                      +----------------------------+-------------------------------+
| • SQLite Logger (events.db)    |                                         (Phone streams pose & camera)
+--------------------------------+
```

---

## 3. Detailed Filesystem Connection Mapping

### 📁 A. Backend Subsystems (`backend/`)

#### 1. Core Vision Pipeline (`backend/core/`)
* **`backend/core/capture.py`**:
  * **Function**: `FrameSource` class that opens webcam `0`, video files (`.mp4`, `.mov`), or network streams (`rtsp://`, `http://`).
  * **Consumers**: Instantiated in `backend/main.py` and `backend/app/copilot_bridge.py`.
* **`backend/core/detector.py`**:
  * **Function**: `Detector` class wrapping Ultralytics YOLO26/YOLOv8 models (`yolo26n.pt`, `yolov8s-worldv2.pt`) for identifying people, PPE gear, forklifts, machinery, and vehicles.
  * **Output**: List of `Detection` dataclass instances with bounding boxes, confidence, class labels, and tracking IDs.
* **`backend/core/pose_estimator.py`**:
  * **Function**: `PoseEstimator` class wrapping `yolo26n-pose.pt`. Extracts 17 COCO keypoints per person, calculates head pose, eye gaze vectors, and body angle.
* **`backend/core/depth_estimator.py`**:
  * **Function**: `DepthEstimator` using MiDaS / Depth Anything to generate relative depth maps from 2D RGB frames, estimating real-world distances in meters.
* **`backend/core/models.py`**:
  * **Function**: Shared Python dataclasses (`Detection`, `TrackedObject`, `FrameResult`, `HazardAssessment`, `DangerZone`, `Severity`).

#### 2. Safety Analytics Engine (`backend/safety/`)
* **`backend/safety/ppe_checker.py`**: Compares detected bounding boxes of workers against required PPE items (hardhats, safety vests, gloves, boots).
* **`backend/safety/fall_detector.py`**: Analyzes torso/hip keypoint trajectories and body angle to flag sudden worker falls or collapses.
* **`backend/safety/zones.py`**: `ZoneManager` maintaining polygonal restricted zones on screen; calculates worker dwell time inside danger perimeters.
* **`backend/safety/hazard_analyzer.py`**: Evaluates proximity between heavy machinery and workers, escalating warnings if paths intersect.
* **`backend/safety/attention_tracker.py`**: Tracks if workers are looking at oncoming hazards or if their gaze is distracted.

#### 3. Alerts & Logging (`backend/alerts/` & `backend/logging_/`)
* **`backend/alerts/tts_engine.py`**: Text-to-speech engine running local speech synthesizers (`pyttsx3`) or cloud TTS to output audible warnings on site.
* **`backend/alerts/alert_manager.py`**: De-duplicates and prioritizes safety alarms with configurable cooldown intervals.
* **`backend/logging_/event_logger.py`**: Writes safety violation timestamps, worker IDs, violation types, and severity to SQLite database `backend/data/events.db`.

#### 4. Unified Web API & Copilot Bridge (`backend/app/`)
* **`backend/app/copilot_bridge.py`**:
  * Thread-safe singleton (`CopilotBridge`) connecting the OpenCV processing loop to FastAPI web streams.
  * Encodes annotated frames to JPEG for `/api/video_feed`.
  * Buffers keypoint data for `/api/pose`.
  * Maintains rolling 8-second temporal image ring buffer for AI questions.
* **`backend/app/main.py`**:
  * FastAPI application running on port `8001`.
  * Exposes endpoints for video feed, 3D pose, voice asking (`/api/ask`), text asking (`/api/ask-text`), and system status (`/api/status`).
* **`backend/app/pipeline.py` & `backend/app/providers/`**:
  * Multimodal voice assistant integrating STT (Sarvam/Whisper), Vision LLM (Gemini 2.5 / Moondream / Gemma), and Docling RAG document search.

---

### 📁 B. Frontend Subsystems (`frontend/`)

#### 1. Pages & Routes (`frontend/src/app/`)
* **`/vision` (`frontend/src/app/vision/page.tsx`)**:
  * Live Safety Copilot workstation.
  * Connects to `http://localhost:8001/api/video_feed` for real-time YOLO HUD stream.
  * Connects to `http://localhost:8001/api/pose` to render real-time interactive 3D skeleton in Three.js.
  * Connects to `http://localhost:8001/api/ask` and `/api/ask-text` for voice + vision AI copilot chat.
* **`/geofence` (`frontend/src/app/geofence/page.tsx`)**:
  * Master Command Center.
  * Displays Leaflet interactive map with real-time worker/vehicle markers.
  * Ingests live telemetry stream via Next.js SSE `/api/telemetry/stream`.
  * Calculates real-time 2D/3D Kinematic Kalman filtering on GPS coordinates.
  * Allows creating and enforcing geofence boundary zones and blind-spot hazard alerts.
* **`/phone` (`frontend/src/app/phone/page.tsx`)**:
  * Mobile Broadcaster application for smartphones connected to the local network.
  * Reads GPS coordinates and hardware IMU (magnetometer/gyroscope orientation).
  * Streams telemetry data to the laptop via HTTP POST `/api/telemetry`.
* **`/slam` (`frontend/src/app/slam/page.tsx`)**:
  * SLAM Robot Odometry and LiDAR mapping interface.
  * Currently renders UI using client-side simulated telemetry.
* **`/reports` (`frontend/src/app/reports/page.tsx`)**:
  * Safety Reports and WorksiteGuard Camera Mesh view.
  * Embeds `WorksiteGuardDashboard.tsx`.

#### 2. Telemetry Ingestion Layer (`frontend/src/lib/` & `api/`)
* **`frontend/src/lib/telemetryStore.ts`**: In-memory registry storing active phone/drone/vehicle telemetry, calculating vision cones (FOV), and cross-checking peer locations for blind spots.
* **`frontend/src/app/api/telemetry/route.ts`**: Next.js App Router API route receiving device poses and notifying subscribers.
* **`frontend/src/app/api/telemetry/stream/route.ts`**: Server-Sent Events (SSE) route broadcasting live updates to dashboard clients with sub-15ms latency.

---

## 4. Deep-Dive: Unmounted & Disconnected Pipelines

### 🟢 Pipeline 1: WorksiteGuard Multi-Camera Mesh Server (Port 8000)
* **Location**: `frontend/yolo/worksite-guard/worksite-guard/server/main.py`
* **What it does**: Provides a standalone YOLO camera mesh network where multiple phones/laptops can connect via WebSocket (`/ws/client`), stream raw camera frames, run YOLO hazard detection, and arbitrate blind-spot warnings on `/ws/dashboard`.
* **Launch Config**: Now automatically launched by `start.bat` as step `[3/3]` on port `8000`.

### 🟡 Pipeline 2: SLAM Robot Odometry & LiDAR Mapping
* **Location**: `frontend/src/components/SlamTelemetry.tsx` & `frontend/src/app/slam/page.tsx`
* **What it does**: Renders robot status, 6-DoF heading, LiDAR point counts (48,500 pts/s), and active geofence zones.
* **Why it is disconnected**:
  * The current implementation uses an internal simulated `setInterval` jitter loop in React state.
  * There is no backend ROS node, UDP telemetry receiver, or serial LiDAR pipeline mounted to feed real robot hardware coordinates into this page.

### 🔴 Pipeline 3: Historical Safety Incident Database (SQLite)
* **Location**: `backend/logging_/event_logger.py` & `backend/data/events.db`
* **What it does**: When the AI Copilot runs, it logs all detected PPE infractions, worker falls, and zone violations to a local SQLite database (`events.db`).
* **Why it is disconnected**:
  * The FastAPI server in `backend/app/main.py` does not provide an endpoint (e.g. `GET /api/events` or `GET /api/incidents`) to query `events.db`.
  * As a result, the frontend Safety Reports page cannot pull real historical incident tables or CSV audit logs from previous monitoring sessions.

---

## 5. How to Launch & Connect All Systems

### Default Execution (`start.bat`)
Now automatically starts all 3 core services:
```bat
[1/3] Frontend:        cd frontend && npm run dev -- -p 3001
[2/3] Python AI Core:  cd backend && python -u main.py --no-display (Port 8001)
[3/3] Worksite Mesh:   cd frontend/yolo/.../server && python main.py (Port 8000)
```
* **Frontend UI**: `http://localhost:3001`
* **Vision & AI Copilot**: `http://localhost:3001/vision`
* **Geofence Command Map**: `http://localhost:3001/geofence`
* **Safety Reports / Mesh**: `http://localhost:3001/reports`
* **Mobile Broadcaster**: `http://<YOUR_LAN_IP>:3001/phone`

