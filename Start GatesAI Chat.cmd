@echo off
setlocal

set "CHAT_DIR=%~dp0"
if "%CHAT_DIR:~-1%"=="\" set "CHAT_DIR=%CHAT_DIR:~0,-1%"
set "BRIDGE_DIR=%CHAT_DIR%\..\gatesai-bridge"
set "BRIDGE_EXE=%BRIDGE_DIR%\bin\gatesai-bridge.exe"

if /I "%~1"=="/check" goto check

call :validate_chat
if errorlevel 1 (
  echo.
  echo Startup checks failed. Fix the issue above, then double-click this file again.
  echo.
  pause
  exit /b 1
)

call :bridge_online
if errorlevel 1 (
  call :validate_bridge_runtime
  if errorlevel 1 (
    echo.
    echo Startup checks failed. Fix the issue above, then double-click this file again.
    echo.
    pause
    exit /b 1
  )

  echo Starting GatesAI Bridge...
  if exist "%BRIDGE_EXE%" (
    start "GatesAI Bridge" powershell -NoExit -ExecutionPolicy Bypass -Command "Set-Location -LiteralPath '%BRIDGE_DIR%'; & '.\bin\gatesai-bridge.exe'"
  ) else (
    start "GatesAI Bridge" powershell -NoExit -ExecutionPolicy Bypass -Command "Set-Location -LiteralPath '%BRIDGE_DIR%'; go run ./cmd/gatesai-bridge"
  )
) else (
  echo GatesAI Bridge is already running on 127.0.0.1:7331; reusing it.
)

echo Starting GatesAI Chat...
start "GatesAI Chat" powershell -NoExit -ExecutionPolicy Bypass -Command "Set-Location -LiteralPath '%CHAT_DIR%'; npm run dev"

echo.
echo GatesAI is starting. If the bridge was already running, only the chat window was opened.
echo Open the local URL printed by the GatesAI Chat window.
echo.
pause
exit /b 0

:check
call :validate_chat
if errorlevel 1 exit /b 1
call :bridge_online
if errorlevel 1 (
  call :validate_bridge_runtime
  if errorlevel 1 exit /b 1
  echo OK: launcher checks passed. Bridge is not running yet, but a start command is available.
) else (
  echo OK: launcher checks passed. Bridge is already running on 127.0.0.1:7331.
)
exit /b 0

:validate_chat
if not exist "%CHAT_DIR%\package.json" (
  echo ERROR: package.json not found in "%CHAT_DIR%".
  exit /b 1
)

where powershell >nul 2>nul
if errorlevel 1 (
  echo ERROR: powershell was not found on PATH.
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo ERROR: npm was not found on PATH. Install Node.js, then try again.
  exit /b 1
)

exit /b 0

:validate_bridge_runtime
if not exist "%BRIDGE_DIR%\go.mod" (
  echo ERROR: gatesai-bridge was not found at "%BRIDGE_DIR%".
  echo Expected it to sit next to the chat project folder.
  exit /b 1
)

if not exist "%BRIDGE_EXE%" (
  where go >nul 2>nul
  if errorlevel 1 (
    echo ERROR: neither "%BRIDGE_EXE%" nor the Go toolchain was found.
    echo Build the bridge exe or install Go 1.24+.
    exit /b 1
  )
)

exit /b 0

:bridge_online
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:7331/health' -TimeoutSec 1; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>nul
exit /b %errorlevel%
