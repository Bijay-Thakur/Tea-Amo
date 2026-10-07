@echo off
cd /d "%~dp0"
echo TEA AMO local app: http://127.0.0.1:8788
echo Administration: /admin    Server: /server
echo.
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install Node.js LTS, then run this file again.
  pause
  exit /b 1
)
if not exist .env (
  echo No .env file. Copy .env.example to .env and add the Supabase keys first.
  pause
  exit /b 1
)
start "" "http://127.0.0.1:8788"
call npm run dev
pause
