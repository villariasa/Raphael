@echo off
setlocal

echo ============================================
echo  Raphael - Windows Installer Build
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js was not found on this machine.
    echo Install it from https://nodejs.org and run this script again.
    pause
    exit /b 1
)

echo [1/3] Installing dependencies...
call npm install
if errorlevel 1 (
    echo [ERROR] npm install failed. See the output above.
    pause
    exit /b 1
)

echo.
echo [2/3] Building Raphael...
call npm run build
if errorlevel 1 (
    echo [ERROR] Build failed. See the output above.
    pause
    exit /b 1
)

echo.
echo [3/3] Packaging the Windows installer...
call npx electron-builder --win --x64
if errorlevel 1 (
    echo [ERROR] Installer packaging failed. See the output above.
    pause
    exit /b 1
)

echo.
echo ============================================
echo  Done. Installer is in the "release" folder.
echo ============================================
start "" explorer "release"

endlocal
