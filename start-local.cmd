@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Install Node.js 22+: https://nodejs.org/& pause& exit /b 1)
where pnpm >nul 2>nul || call corepack enable
call pnpm install || pause
start "Afterglow" http://localhost:4800
call pnpm start
