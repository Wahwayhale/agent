@echo off
chcp 65001 >nul
title FullStack Agent Desktop - Build & Package

echo ========================================
echo   FullStack Agent Desktop - Build
echo ========================================
echo.

:: Check Node.js
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed!
    pause
    exit /b 1
)

echo [1/4] Installing dependencies...
call npm install
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install dependencies!
    pause
    exit /b 1
)

echo [2/4] Building frontend...
call npm run build
if %errorlevel% neq 0 (
    echo [ERROR] Failed to build frontend!
    pause
    exit /b 1
)

echo [3/4] Packaging as Windows exe...
call npx electron-builder --win
if %errorlevel% neq 0 (
    echo [ERROR] Failed to package exe!
    pause
    exit /b 1
)

echo [4/4] Copying installer to Desktop...
if exist "dist\FullStack Agent Desktop Setup 1.0.0.exe" (
    copy "dist\FullStack Agent Desktop Setup 1.0.0.exe" "%USERPROFILE%\Desktop\"
    echo.
    echo ========================================
    echo   Build Complete!
    echo   Installer: Desktop\FullStack Agent Desktop Setup 1.0.0.exe
    echo ========================================
) else (
    echo [WARNING] Installer not found in dist folder
    echo Check dist\ folder for output
)

echo.
echo Press any key to exit...
pause >nul
