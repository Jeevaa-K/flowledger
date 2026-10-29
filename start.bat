@echo off
title FlowLedger Launcher
echo ========================================================
echo  Starting FlowLedger Services
echo ========================================================
echo.

:: Try to start PostgreSQL service if stopped
echo [1/2] Ensuring PostgreSQL service is running...
net start postgresql-x64-18 >nul 2>&1

:: Navigate to backend and launch dev server
echo [2/2] Starting Backend Server on port 3001...
cd /d "%~dp0backend"
echo.
echo ========================================================
echo  FlowLedger is running at http://localhost:3001
echo ========================================================
echo.
npm run dev

