@echo off
echo ====================================================
echo        Kaya AI System - One-Click Launcher
echo ====================================================
echo.
echo [1/2] Starting Next.js Frontend (Port 3001)...
start "Kaya Frontend" cmd /k "cd frontend && npm run dev -- -p 3001"

echo [2/2] Starting Python AI Backend (Port 8001)...
start "Kaya Backend" cmd /k "cd backend && python main.py --no-display"

echo.
echo Both systems are booting up in separate windows!
echo Once they are ready, open your browser to: http://localhost:3001/vision
echo.
pause
