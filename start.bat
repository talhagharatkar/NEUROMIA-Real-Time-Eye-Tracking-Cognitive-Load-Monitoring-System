@echo off
title NEUROMIA System Startup

echo ===================================================
echo   🧠 NEUROMIA — Cognitive Intelligence System
echo ===================================================
echo.

:: Check for python virtual environment
if not exist ".venv\Scripts\python.exe" (
    echo [ERROR] Python virtual environment not found in .venv/
    echo Please run: python -m venv .venv
    pause
    exit /b
)

echo [1/3] Starting Uvicorn backend server on http://127.0.0.1:8000...
start "Neuromia Backend (FastAPI)" cmd /c ".venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000"

echo [2/3] Starting HTTP server for frontend on http://localhost:8080...
start "Neuromia Frontend (Web Server)" cmd /c ".venv\Scripts\python.exe -m http.server 8080"

:: Wait 3 seconds for servers to initialize (using ping which is safe from input redirection)
ping -n 4 127.0.0.1 >nul

echo [3/3] Launching Neuromia web application in browser...
start http://localhost:8080

echo.
echo ===================================================
echo   System is now LIVE!
echo   - Backend API: http://127.0.0.1:8000
echo   - Frontend App: http://localhost:8080
echo.
echo   To stop all servers, close the backend and web
echo   server command prompt windows.
echo ===================================================
echo.

:: Infinite sleep loop using ping (safest way to keep process running without pause/timeout)
:loop
ping -n 60 127.0.0.1 >nul
goto loop
