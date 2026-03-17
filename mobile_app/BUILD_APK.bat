@echo off
echo ===========================================
echo       OMNINOTE INDUSTRIAL - APK BUILD
echo ===========================================
echo.
echo 1. Initializing EAS...
cd /d %~dp0
call npx eas-cli login
echo.
echo 2. Committing Local Vault State...
call npx eas-cli build -p android --profile preview
echo.
echo 3. Build dispatched. Check Expo Dashboard for Progress.
pause
