"""
KAYA Central Controller Launcher
Runs the FastAPI WebSocket & Telemetry Central Hub
"""
import sys
import subprocess
import uvicorn
from server import app

if __name__ == "__main__":
    print("=" * 60)
    print("  KAYA TELEMETRY HUB - STARTING CENTRAL WEBSOCKET SERVER")
    print("=" * 60)
    print("Server running on port 8000 (accessible on LAN)")
    print("For Next.js frontend, run: npm run dev:https or npm run dev")
    print("=" * 60)
    uvicorn.run(app, host="0.0.0.0", port=8000)
