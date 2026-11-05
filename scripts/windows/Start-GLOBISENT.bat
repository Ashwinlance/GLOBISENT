@echo off
setlocal
cd /d "%~dp0\..\.."

echo.
echo  GLOBISENT - Global Intelligence Command Center
echo  ----------------------------------------------

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js is not installed.
  echo Install Node.js 24.14+ or 26.x, then run this launcher again.
  pause
  exit /b 1
)

node -e "const [a,b]=process.versions.node.split('.').map(Number);if(!((a===24&&b>=14)||a===26))process.exit(1)"
if errorlevel 1 (
  echo ERROR: This project requires Node.js 24.14+ or 26.x.
  echo Your installed version is:
  node --version
  echo Install a supported Node.js version and run npm ci once.
  pause
  exit /b 1
)

if not exist "node_modules\vite\package.json" (
  echo Dependencies are not installed. Run: npm ci
  pause
  exit /b 1
)

start "GLOBISENT local server" /min cmd /c "npm run dev -- --host 127.0.0.1 --port 4173 --strictPort"
timeout /t 7 /nobreak >nul
start "" "http://127.0.0.1:4173"
endlocal
