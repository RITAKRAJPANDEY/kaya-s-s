@echo off
echo ====================================================
echo        Kaya AI System - One-Click Launcher
echo ====================================================
echo.
echo [1/3] Starting Next.js Frontend (Port 3001)...
start "Kaya Frontend" cmd /k "cd frontend && npm run dev -- -p 3001"

echo [2/3] Starting Python AI Backend (Port 8001)...
start "Kaya Backend" cmd /k "cd backend && if exist .venv\Scripts\python.exe (.venv\Scripts\python.exe -u main.py --no-display) else (python -u main.py --no-display)"

echo [3/3] Starting WorksiteGuard YOLO Hub (Port 8000)...
start "WorksiteGuard Hub" cmd /k "cd frontend\yolo\worksite-guard\worksite-guard\server && if exist ..\..\..\..\..\backend\.venv\Scripts\python.exe (..\..\..\..\..\backend\.venv\Scripts\python.exe main.py) else (python main.py)"

echo.
echo All 3 systems are booting up in separate windows!
echo Once they are ready, open your browser to:
echo   - Safety Copilot Vision:  http://localhost:3001/vision
echo   - Geofence Command Map:   http://localhost:3001/geofence
echo   - Safety Reports / Mesh:  http://localhost:3001/reports
echo   - Phone Broadcaster:      http://<YOUR_LAN_IP>:3001/phone
echo.
pause

