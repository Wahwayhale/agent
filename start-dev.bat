@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo ========================================
echo   FullStack Agent Desktop - Dev Mode
echo ========================================
echo.

echo [1/2] Starting Vite dev server...
start "Vite" cmd /k "cd /d "%~dp0" && npx vite"

echo Waiting for Vite to start...
timeout /t 3 /nobreak

echo [2/2] Starting Electron...
cd /d "%~dp0"
npx electron .

echo.
pause
