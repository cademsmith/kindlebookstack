@echo off
REM Daily Hardcover -> Shelfarr bridge run. Run by Windows Task Scheduler.
REM Pulls new Want to Read additions and requests them via Shelfarr, trickling out
REM MAX_REQUESTS_PER_RUN at a time. Appends output to data\bridge.log.
cd /d "%~dp0.."
echo ==== %DATE% %TIME% ==== >> "data\bridge.log"
"C:\Program Files\nodejs\node.exe" scripts\bridge.mjs >> "data\bridge.log" 2>&1
