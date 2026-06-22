@echo off
chcp 65001 >nul
title FullStack Agent Desktop - Dev Server

echo.
echo ========================================
echo   FullStack Agent Desktop - Dev Server
echo ========================================
echo.

:: Change to script directory
cd /d "%~dp0"

:: Check Node.js
echo Checking Node.js...
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed!
    echo Please install Node.js from https://nodejs.org
    echo.
    pause
    exit /b 1
)
echo [OK] Node.js detected

:: Check npm
echo Checking npm...
npm -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] npm is not installed!
    echo.
    pause
    exit /b 1
)
echo [OK] npm detected

:: Check node_modules
if not exist "node_modules" (
    echo.
    echo [1/3] Installing dependencies...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to install dependencies!
        echo.
        pause
        exit /b 1
    )
    echo [OK] Dependencies installed
) else (
    echo [OK] Dependencies already installed
)

:: Start Vite
echo.
echo [2/3] Starting Vite dev server...
start "Vite Dev Server" cmd /k "cd /d "%~dp0" && npm run dev"

:: Wait for Vite to start
echo Waiting for Vite to start (5 seconds)...
timeout /t 5 /nobreak

:: Start Electron
echo [3/3] Starting Electron...
start "Electron" cmd /k "cd /d "%~dp0" && npx electron ."

echo.
echo ========================================
echo   Servers started!
echo   - Vite: http://localhost:5173
echo   - Electron: Desktop App
echo ========================================
echo.
echo You can close this window now.
echo The servers are running in separate windows.
echo.
pause
