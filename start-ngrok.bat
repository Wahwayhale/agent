@echo off
chcp 65001 >nul
title FullStack Agent Desktop - Ngrok Proxy

echo ========================================
echo   FullStack Agent Desktop - Ngrok Proxy
echo ========================================
echo.

:: Check ngrok
ngrok -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Ngrok is not installed!
    echo.
    echo Install ngrok:
    echo   1. Visit https://ngrok.com
    echo   2. Download and install ngrok
    echo   3. Run: ngrok config add-authtoken YOUR_TOKEN
    echo.
    pause
    exit /b 1
)

echo [1/2] Starting Vite dev server...
start "Vite Dev Server" cmd /k "npm run dev"

:: Wait for Vite to start
echo Waiting for Vite to start...
timeout /t 5 /nobreak >nul

echo [2/2] Starting ngrok tunnel on port 5173...
echo.
echo ========================================
echo   Ngrok Tunnel Active!
echo   Local:  http://localhost:5173
echo   Public: Check ngrok URL below
echo ========================================
echo.
ngrok http 5173

echo.
echo Press any key to exit...
pause >nul
