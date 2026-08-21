@echo off
echo ====================================================
echo        Kaya AI System - One-Click Launcher
echo ====================================================
echo.
echo [1/3] Starting Next.js Frontend (Port 3001)...
start "Kaya Frontend" cmd /k "cd frontend && npm run dev -- -H 0.0.0.0 -p 3001"

echo [2/3] Starting Python AI Backend (Port 8001)...
start "Kaya Backend" cmd /k "cd backend && if exist .venv\Scripts\python.exe (.venv\Scripts\python.exe -u main.py --no-display) else (python -u main.py --no-display)"

echo [3/3] Starting WorksiteGuard YOLO Hub (Port 8000)...
start "WorksiteGuard Hub" cmd /k "cd frontend\yolo\worksite-guard\worksite-guard\server && if exist ..\..\..\..\..\backend\.venv\Scripts\python.exe (..\..\..\..\..\backend\.venv\Scripts\python.exe main.py) else (python main.py)"

echo [4/4] Starting MUSt3R Native Viser Studio (Port 7860 / 8080)...
start "MUSt3R Native Studio" cmd /k "cd slam\must3r && mast3r_env\Scripts\python.exe -u demo.py --weights checkpoints\MUSt3R_512.pth --retrieval checkpoints\MUSt3R_512_retrieval_trainingfree.pth --image_size 512 --device cuda --amp bf16 --viser --embed_viser --allow_local_files --server_port 7860 --server_name 0.0.0.0"

echo.
echo All 4 systems are booting up in separate windows!
echo Once they are ready, open your browser to:
echo   - Safety Copilot Vision:  http://localhost:3001/vision
echo   - Geofence Command Map:   http://localhost:3001/geofence
echo   - 3D SLAM (MUSt3R Mesh):  http://localhost:3001/slam
echo   - Safety Reports / Mesh:  http://localhost:3001/reports
echo   - Phone Broadcaster:      http://<YOUR_LAN_IP>:3001/phone
echo.
pause

