# 🏗️ Kaya — Job Site Safety Copilot & Voice+Vision Assistant

> A real-time, edge-accelerated computer vision pipeline and multimodal AI safety copilot for construction job sites. Kaya combines multi-model object & tool detection (YOLO11 COCO + YOLO-World + YOLO26 PPE), 17-keypoint worker pose estimation, Depth Anything V2 metric distance calculation, and attention-based hazard escalation with an interactive, side-by-side **Voice + Vision Multimodal Copilot** powered by Google Gemini, NVIDIA NIM, and Sarvam AI.

Built for the **Kaya Hackathon** by Team Antigravity.

---

## 📋 Table of Contents

- [Key Features](#-key-features)
- [System Architecture](#-system-architecture)
- [Side-by-Side Web Dashboard](#-side-by-side-web-dashboard)
- [Multimodal Voice + Vision Pipeline](#-multimodal-voice--vision-pipeline)
- [Computer Vision Engine (Tier 1)](#-computer-vision-engine-tier-1)
- [Raspberry Pi 5 & IP Camera Streaming](#-raspberry-pi-5--ip-camera-streaming)
- [Project Structure](#-project-structure)
- [Getting Started & Installation](#-getting-started--installation)
- [Configuration Reference (`config.yaml` & `.env`)](#-configuration-reference)
- [REST API Reference](#-rest-api-reference)
- [Automated Testing](#-automated-testing)
- [License](#-license)

---

## ⚡ Key Features

1. **Multi-Model Real-Time Computer Vision Pipeline (28+ FPS on Apple Silicon)**:
   - **General COCO Detection (YOLO11n)**: Detects persons, vehicles, workplace equipment, and 80 standard COCO classes.
   - **Open-Vocabulary Tool Detection (YOLO-World v2)**: Detects 125+ specialized construction and workshop hand tools, power tools, safety gear, infrastructure items, and site hazards.
   - **Job-Site PPE Compliance**: Monitors hardhats, safety vests, masks, and flags missing PPE in real time.
   - **17-Keypoint YOLO-Pose Estimation**: Tracks worker posture, head yaw angle, and fall events.
   - **Monocular Depth Anything V2 (Metric)**: Computes direct physical distance in meters to every tracked worker, vehicle, tool, and hazard without stereo cameras or LiDAR.
   - **Gaze & Attention Tracking**: Evaluates whether a worker is looking at an approaching hazard. If unnoticed for 4+ seconds, automatically escalates danger severity.

2. **Unified Side-by-Side Web Dashboard**:
   - **Left Panel**: Live annotated computer vision stream with YOLO bounding boxes, distance overlays, pose skeletons, wrist-to-tool carrying links, and real-time metric pills (`● Objects Tracked`, `● Hazards Active`, `● Buffer: 6/8 frames`, `30 FPS`).
   - **Right Panel**: Push-to-Talk interactive conversation feed with message bubbles, latency breakdown tags (`STT: 0ms | VLM: 1.4s | TTS: 0.8s`), and text input bar.

3. **Modular Multimodal Vision Reasoning**:
   - Supports **Google Gemini 3.5 Flash**, **NVIDIA NIM (`meta/llama-3.2-11b-vision-instruct`)**, and **Local Ollama**.
   - **1-FPS Rolling Temporal Frame Buffer**: Retains a rolling 6-8 second chronological frame sequence, allowing the model to analyze dynamic motion (*"What just fell?"*, *"Which worker left the zone?"*).
   - **Benchmarking Mode Switcher**: Easily toggle between `🎞️ Temporal Frames` and `🖼️ Single Frame`.

4. **Zero-Latency Resilient Speech Engine**:
   - **Sarvam AI TTS** (`bulbul:v3/shubh`): High-clarity natural speech with automatic fallback.
   - **macOS Native Speech Engine** (`/usr/bin/say -v 'Samantha'`): 0ms network latency Apple Silicon on-device speech synthesis.
   - **Web Speech API**: Client-side audio failover if network interruptions occur.

---

## 🏛️ System Architecture

```
                                      ┌────────────────────────────────────────────────────────┐
                                      │              INPUT VIDEO SOURCE                        │
                                      │   Webcam / Pi 5 Camera / RTSP Stream / MP4 Video       │
                                      └──────────────────────────┬─────────────────────────────┘
                                                                 │
                                                                 ▼
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                          KAYA SAFETY COPILOT COMPUTER VISION ENGINE                                            │
│                                                                                                                                │
│  ┌─────────────────────────┐   ┌─────────────────────────┐   ┌─────────────────────────┐   ┌─────────────────────────┐         │
│  │ YOLO11 COCO General Det │   │ YOLO-World Tool Scanner │   │ 17-Keypoint YOLO-Pose   │   │ Depth Anything V2 Metric│         │
│  │ Persons, Trucks, Items  │   │ 125+ Construction Tools │   │ Posture & Fall Detection│   │ Physical Depth (meters) │         │
│  └────────────┬────────────┘   └────────────┬────────────┘   └────────────┬────────────┘   └────────────┬────────────┘         │
│               │                             │                             │                             │                      │
│               └─────────────────────────────┼─────────────────────────────┴─────────────────────────────┘                      │
│                                             ▼                                                                                  │
│                                ┌─────────────────────────┐                                                                     │
│                                │ Hazard & Attention Eval │ (Gaze Yaw Bearing + Dwell Time Escalation)                          │
│                                └────────────┬────────────┘                                                                     │
│                                             │                                                                                  │
│                                             ▼                                                                                  │
│                                ┌─────────────────────────┐                                                                     │
│                                │ OverlayRenderer (OpenCV)│ (Bounding boxes, distance badges, tool links, danger zones)         │
│                                └────────────┬────────────┘                                                                     │
└─────────────────────────────────────────────┼──────────────────────────────────────────────────────────────────────────────────┘
                                              │
                                              ▼ (Thread-Safe Buffer)
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                            COPILOT BRIDGE (app/copilot_bridge.py)                                              │
│  - MJPEG Frame Generator (GET /api/video_feed @ 30 FPS)                                                                        │
│  - Rolling 1-FPS Temporal Ring Buffer (6-8s chronological frame history for VLM queries)                                       │
└─────────────────────────────────────────────┬──────────────────────────────────────────────────────────────────────────────────┘
                                              │
                                              ▼
┌────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       UNIFIED FASTAPI SERVER & SIDE-BY-SIDE DASHBOARD                                          │
│                                                                                                                                │
│  ┌─────────────────────────────────────────────────┐        ┌────────────────────────────────────────────────────────┐         │
│  │ LEFT: Live Safety Copilot Computer Vision Feed  │        │ RIGHT: Voice + Vision Interactive Chat Copilot         │         │
│  │  - Live YOLO Boxes, Keypoints, Metric Distances │        │  - Push-to-Talk (<kbd>Space</kbd> / Mic Button)        │         │
│  │  - Live HUD Badges (Objects, Hazards, FPS)      │        │  - STT: Google Gemini / Sarvam AI / Whisper            │         │
│  │  - MJPEG Video Stream (/api/video_feed)         │        │  - VLM: Gemini 3.5 Flash / NVIDIA NIM Llama 3.2 Vision │         │
│  │                                                 │        │  - TTS: Sarvam AI / macOS Native Samantha Speech       │         │
│  └─────────────────────────────────────────────────┘        └────────────────────────────────────────────────────────┘         │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🎨 Side-by-Side Clean Dashboard

The dashboard utilizes a clean, modern white theme (`#ffffff` / `#f8fafc`) designed for clarity on site monitors and mobile tablets:

- **Left Panel (Video Output)**: Real-time OpenCV HUD streaming active detections, distance tags, pose skeletons, and tool-carrying links.
- **Right Panel (Copilot Conversation)**: Push-to-Talk recording bar with <kbd>Space</kbd> shortcut, text query input form, and conversational turn history with timing breakdowns.
- **Benchmarking Mode Switcher**: Instantly switch between `🎞️ Temporal Frames` (multi-frame chronological sequence) and `🖼️ Single Frame` mode.

---

## 🧠 Multimodal Voice + Vision Pipeline

When a voice or text query is submitted:
1. **Audio Transcription (STT)**: Transcribes the spoken audio into text via Gemini Audio Understanding or Sarvam AI.
2. **Temporal Frame Extraction**: Retrieves the latest rolling sequence of frames from the 1-FPS ring buffer.
3. **Multimodal Reasoning (VLM)**: Passes the visual sequence + query to the configured VLM provider using a concise, direct system prompt.
4. **Speech Synthesis (TTS)**: Synthesizes high-fidelity voice audio via Sarvam AI with immediate fallback to macOS Native Speech (`/usr/bin/say`).

---

## 📹 Raspberry Pi 5 & IP Camera Streaming

Kaya includes a built-in lightweight streaming server (`pi_stream/stream_server.py`) for Raspberry Pi 5 with IMX219 / libcamera sensors:

```bash
# On Raspberry Pi 5:
python3 pi_stream/stream_server.py --port 8554 --width 1280 --height 720 --fps 30

# On Mac / Host:
python main.py --source http://<PI_IP_ADDRESS>:8554
```

---

## 📁 Project Structure

```
kaya hackathon/
├── alerts/                 # TTS audio alerts & priority manager
│   ├── alert_manager.py    # Hazard alert generation & spatial cues
│   └── tts_engine.py       # macOS native voice alert dispatcher
├── app/                    # Voice + Vision Multimodal Backend
│   ├── config.py           # Pydantic v2 settings & environment variables
│   ├── copilot_bridge.py   # Thread-safe MJPEG streaming & temporal buffer
│   ├── factory.py          # Provider factory (Gemini, NVIDIA, Sarvam, Ollama, Mac)
│   ├── interfaces.py       # Abstract Base Classes (STTProvider, VisionReasoner, TTSProvider)
│   ├── main.py             # FastAPI web application endpoints
│   ├── pipeline.py         # KayaPipeline orchestrating STT -> VLM -> TTS
│   └── providers/          # Modular provider implementations
│       ├── stt/            # Gemini STT, Sarvam STT, Mock STT
│       ├── vision/         # Gemini 3.5 Flash, NVIDIA NIM Llama 3.2, Ollama, Mock
│       └── tts/            # Sarvam AI TTS, macOS Native TTS, Mock TTS
├── core/                   # Real-time Edge Computer Vision Pipeline
│   ├── capture.py          # Unified FrameSource (Webcam, RTSP, Video, Image)
│   ├── depth_estimator.py  # Depth Anything V2 monocular metric depth
│   ├── detector.py         # Multi-model YOLO11 + YOLO-World + PPE detector
│   ├── device.py           # Apple Silicon MPS / CPU device manager
│   ├── models.py           # Dataclasses (Detection, TrackedObject, FrameResult)
│   └── pose_estimator.py   # 17-keypoint skeleton & head yaw estimator
├── data/                   # Safety event logger SQLite database (events.db)
├── display/                # OpenCV HUD overlay renderer with rich color palettes
├── integration/            # VLMHook multimodal reasoner bridge
├── logging_/               # Structured SQLite event logging
├── models/                 # ByteTrack tracking configuration
├── pi_stream/              # Raspberry Pi stream server script
├── static/                 # White-themed dashboard UI (HTML, CSS, JS)
├── tests/                  # Automated pytest unit & pipeline test suite
├── config.yaml             # Safety copilot computer vision configuration
├── main.py                 # Unified Safety Copilot + Web Server entry point
├── requirements.txt        # Python dependency manifest
└── run_voice_assistant.py  # Standalone assistant launcher
```

---

## 🚀 Getting Started & Installation

### 1. Prerequisites
- macOS (Apple Silicon recommended) or Linux
- Python 3.10 to 3.13
- Webcam, Raspberry Pi camera, or video file

### 2. Setup Virtual Environment
```bash
cd "kaya hackathon"
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 3. Configure `.env`
Create or edit your `.env` file:
```ini
# Vision Reasoner (gemini | nvidia | ollama | mock)
VISION_PROVIDER=gemini
GEMINI_MODEL=gemini-3.5-flash
GEMINI_API_KEY=AIzaSy...

# STT Provider (gemini | sarvam | mock)
STT_PROVIDER=gemini

# TTS Provider (sarvam | mac | mock)
TTS_PROVIDER=sarvam
SARVAM_API_KEY=...

# NVIDIA NIM (Optional)
NVIDIA_API_KEY=nvapi-...
NVIDIA_MODEL=meta/llama-3.2-11b-vision-instruct
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1

# Temporal Buffer Settings
FRAME_MODE=TEMPORAL_FRAMES
TEMPORAL_BUFFER_SECONDS=6.0
TEMPORAL_FPS=1.0
TEMPORAL_MAX_FRAMES=8
```

### 4. Run the Application

#### Option A: Unified Safety Copilot & Web Dashboard (Recommended)
```bash
python main.py
```
*Starts both the OpenCV safety engine and the web dashboard at `http://127.0.0.1:8000`.*

#### Option B: Run on a Specific Video File
```bash
python main.py --source test_videos/13771068_1920_1080_60fps.mp4
```

#### Option C: Start Web Assistant Server Standalone
```bash
python run_voice_assistant.py
```

Open **`http://127.0.0.1:8000`** in your browser.

---

## ⚙️ Configuration Reference

### `config.yaml`
Controls the computer vision pipeline parameters:
- `models.general`: High-speed YOLO11n COCO detector for general workplace objects (`confidence: 0.30`).
- `models.tool`: Open-vocabulary YOLO-World tool detector loaded with 125+ construction and workshop items (`confidence: 0.20`).
- `models.ppe`: Path and confidence thresholds for PPE detection.
- `models.pose`: 17-keypoint pose estimation settings (`run_every_n_frames: 3`).
- `models.depth`: Depth Anything V2 Metric (Outdoor Small) direct distance estimation.
- `escalation.dwell_threshold_seconds`: Time before unnoticed hazards escalate (default: `4.0s`).

---

## 📡 REST API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/` | Serves the web dashboard UI. |
| `GET` | `/api/video_feed` | High-speed multipart MJPEG video stream of annotated YOLO frames. |
| `GET` | `/api/status` | System health, provider statuses, copilot FPS, and tracked objects. |
| `POST` | `/api/ask` | Multipart audio voice + image frames query. Returns answer + WAV audio. |
| `POST` | `/api/ask-text` | Direct text question + image frames query. |
| `POST` | `/api/reset` | Clears conversation context history. |

---

## 🧪 Automated Testing

Run the automated pytest test suite:
```bash
pytest -v tests/
```

All 16 unit and pipeline tests pass:
- ✅ `test_depth.py`: Depth Anything V2 physical metric distance calculations.
- ✅ `test_detector.py`: Multi-model deduplication, spatial tool tracking, and name normalizations.
- ✅ `test_voice_assistant_endpoints.py`: FastAPI endpoints (`/status`, `/reset`, `/ask`, `/ask-text`).
- ✅ `test_voice_assistant_factories.py`: Provider initialization (Gemini, NVIDIA, Sarvam, Ollama, Mac).
- ✅ `test_voice_assistant_pipeline.py`: End-to-end multimodal pipeline turn execution.

---

## 📄 License

This project is licensed under the MIT License.
