#!/usr/bin/env bash
# deploy.sh — Deploy and start the Pi camera stream server.
#
# Usage:
#   ./pi_stream/deploy.sh                          # defaults
#   ./pi_stream/deploy.sh --width 1920 --height 1080 --fps 25
#   PI_HOST=10.0.0.5 PI_USER=pi PI_PASS=secret ./pi_stream/deploy.sh
#
# Environment variables (with defaults):
#   PI_HOST  — Pi IP address     (default: 10.201.61.195)
#   PI_USER  — SSH user          (default: raycon)
#   PI_PASS  — SSH password      (default: raycon)
#   PI_PORT  — Stream HTTP port  (default: 8554)

set -euo pipefail

# ── Config ──
PI_HOST="${PI_HOST:-10.201.61.195}"
PI_USER="${PI_USER:-raycon}"
PI_PASS="${PI_PASS:-raycon}"
PI_PORT="${PI_PORT:-8554}"
REMOTE_DIR="/home/${PI_USER}/pi_stream"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STREAM_SCRIPT="${SCRIPT_DIR}/stream_server.py"

# Forward extra args (e.g. --width 1920 --height 1080)
EXTRA_ARGS="${*:-}"

echo "╔══════════════════════════════════════════════╗"
echo "║   Pi Camera Stream — Deploy & Start          ║"
echo "╠══════════════════════════════════════════════╣"
echo "║  Host : ${PI_HOST}                           "
echo "║  User : ${PI_USER}                           "
echo "║  Port : ${PI_PORT}                           "
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── 1. Kill any existing stream process ──
echo "→ Stopping any existing stream server..."
sshpass -p "${PI_PASS}" ssh -o StrictHostKeyChecking=no "${PI_USER}@${PI_HOST}" \
    "pkill -f 'stream_server.py' 2>/dev/null || true" || true

# ── 2. Create remote dir & copy script ──
echo "→ Deploying stream_server.py to Pi..."
sshpass -p "${PI_PASS}" ssh -o StrictHostKeyChecking=no "${PI_USER}@${PI_HOST}" \
    "mkdir -p ${REMOTE_DIR}"

sshpass -p "${PI_PASS}" scp -o StrictHostKeyChecking=no \
    "${STREAM_SCRIPT}" "${PI_USER}@${PI_HOST}:${REMOTE_DIR}/stream_server.py"

# ── 3. Start the stream in background (fully detached from SSH) ──
echo "→ Starting stream server on Pi (port ${PI_PORT})..."
sshpass -p "${PI_PASS}" ssh -o StrictHostKeyChecking=no "${PI_USER}@${PI_HOST}" \
    "cd ${REMOTE_DIR} && nohup python3 stream_server.py --port ${PI_PORT} ${EXTRA_ARGS} > stream.log 2>&1 </dev/null & disown"

# ── 4. Wait for startup and verify ──
echo "→ Waiting for server to start..."
sleep 3

echo "→ Checking health endpoint..."
HEALTH=$(curl -s --connect-timeout 5 "http://${PI_HOST}:${PI_PORT}/" 2>/dev/null || echo "FAIL")

if echo "${HEALTH}" | grep -q '"status"'; then
    echo ""
    echo "✅ Stream server is running!"
    echo ""
    echo "  📹 Live stream : http://${PI_HOST}:${PI_PORT}/stream"
    echo "  📸 Snapshot    : http://${PI_HOST}:${PI_PORT}/snapshot"
    echo "  💊 Health      : http://${PI_HOST}:${PI_PORT}/"
    echo ""
    echo "  Run your pipeline:"
    echo "    python main.py --source http://${PI_HOST}:${PI_PORT}/stream"
    echo ""
else
    echo ""
    echo "⚠️  Health check failed. Checking logs..."
    sshpass -p "${PI_PASS}" ssh -o StrictHostKeyChecking=no "${PI_USER}@${PI_HOST}" \
        "tail -20 ${REMOTE_DIR}/stream.log 2>/dev/null || echo 'No log file found'"
    echo ""
    echo "Try manually:"
    echo "  sshpass -p ${PI_PASS} ssh ${PI_USER}@${PI_HOST} 'python3 ${REMOTE_DIR}/stream_server.py'"
    exit 1
fi
