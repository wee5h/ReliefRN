@echo off
rem Double-click to run Harbor with the ReliefRN live agents. See RUN-LOCALLY.md.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-demo.ps1" %*
pause
