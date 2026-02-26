@echo off
setlocal enableextensions enabledelayedexpansion

rem Use UTF-8 to display messages correctly
chcp 65001 >nul

rem Change to repository directory
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Install Node.js v18 or newer: https://nodejs.org/
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm not found. Install Node.js v18 or newer: https://nodejs.org/
  pause
  exit /b 1
)

call :resolve_port
if not defined APP_PORT set "APP_PORT=3000"

echo Starting djTRON player on port !APP_PORT!...
start "" "http://localhost:!APP_PORT!/"

rem Start server
title djTRON
node server.js

endlocal
exit /b 0

:resolve_port
set "APP_PORT="

if defined PORT (
  call :validate_port "%PORT%"
  if defined VALID_PORT set "APP_PORT=!VALID_PORT!"
)

if defined APP_PORT goto :eof

if exist "extra.conf" (
  for /f "usebackq delims=" %%L in (`findstr /R /I "^[ ]*port[ ]*[=:]" "extra.conf"`) do (
    set "CFG_LINE=%%L"
    for /f "tokens=1* delims==:" %%A in ("!CFG_LINE!") do set "CFG_VALUE=%%B"
    call :clean_value "!CFG_VALUE!"
    call :validate_port "!CLEAN_VALUE!"
    if defined VALID_PORT (
      set "APP_PORT=!VALID_PORT!"
      goto :eof
    )
  )
)

set "APP_PORT=3000"
goto :eof

:clean_value
set "CLEAN_VALUE=%~1"
if not defined CLEAN_VALUE goto :eof

for /f "tokens=* delims= " %%A in ("%CLEAN_VALUE%") do set "CLEAN_VALUE=%%A"

:trim_right_spaces
if defined CLEAN_VALUE if "!CLEAN_VALUE:~-1!"==" " (
  set "CLEAN_VALUE=!CLEAN_VALUE:~0,-1!"
  goto :trim_right_spaces
)

set "CLEAN_VALUE=!CLEAN_VALUE:"=!"
set "CLEAN_VALUE=!CLEAN_VALUE:'=!"

goto :eof

:validate_port
set "VALID_PORT="
set "HAS_NON_DIGITS="
set "PORT_INPUT=%~1"
if not defined PORT_INPUT goto :eof

for /f "delims=0123456789" %%A in ("%PORT_INPUT%") do set "HAS_NON_DIGITS=%%A"
if defined HAS_NON_DIGITS goto :eof

set /a PORT_NUM=%PORT_INPUT% >nul 2>&1
if errorlevel 1 goto :eof
if %PORT_NUM% LSS 1 goto :eof
if %PORT_NUM% GTR 65535 goto :eof

set "VALID_PORT=%PORT_NUM%"
goto :eof
