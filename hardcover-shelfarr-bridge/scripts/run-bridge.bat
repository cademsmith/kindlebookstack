@echo off
REM Daily Hardcover -> Shelfarr bridge run. Run by Windows Task Scheduler.
REM Runs EVERY user (base .env + every profiles/*.env), each trickling out
REM MAX_REQUESTS_PER_RUN at a time. Appends output to data\bridge.log.
cd /d "%~dp0.."
echo ==== %DATE% %TIME% ==== >> "data\bridge.log"
"C:\Program Files\nodejs\node.exe" scripts\run-all.mjs >> "data\bridge.log" 2>&1
