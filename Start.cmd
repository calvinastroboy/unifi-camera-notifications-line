@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 22 or newer from https://nodejs.org and open this file again.
  pause
  exit /b 1
)
node -e "if(Number(process.versions.node.split('.')[0])<22)process.exit(1)"
if errorlevel 1 (
  echo Node.js 22 or newer is required.
  pause
  exit /b 1
)
if not exist node_modules\wrangler\bin\wrangler.js (
  echo Installing required packages for first launch...
  call npm ci
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
node scripts/ui.mjs
pause
