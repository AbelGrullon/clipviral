@echo off
chcp 65001 >nul
setlocal EnableExtensions DisableDelayedExpansion
title ClipViral - Grabar video para Meta

rem ══════════════════════════════════════════════════════════════════════════
rem  Graba el video de demostración que pide la revisión de Meta.
rem  Se abre una ventana con los pasos: haces cada uno en ClipViral y en el
rem  navegador, y tocas "Listo" (o F9). El panel con los pasos NO sale en el video.
rem  Al final queda un .mp4 con subtítulos en inglés en la carpeta "Videos para Meta".
rem  Antes: abre ClipViral con "Iniciar ClipViral.bat" y lee GUION-VIDEO-META.md.
rem ══════════════════════════════════════════════════════════════════════════

for /f %%e in ('echo prompt $E^| cmd') do set "ESC=%%e"
set "C0=%ESC%[0m"
set "CR=%ESC%[91m"
set "CC=%ESC%[96m"
set "CN=%ESC%[1m"

set "PERFIL=%APPDATA%\ClipViral"
if defined CLIPVIRAL_PERFIL set "PERFIL=%CLIPVIRAL_PERFIL%"

rem Carpeta de ClipViral: la de este archivo o, si lo copiaste a otro lugar, la de la última vez que se abrió.
set "RAIZ=%~dp0"
if exist "%RAIZ%desktop\grabador\main.js" goto :carpeta_ok
if exist "%PERFIL%\carpeta.txt" set /p "RAIZ=" <"%PERFIL%\carpeta.txt"
if not exist "%RAIZ%desktop\grabador\main.js" goto :sin_carpeta
:carpeta_ok

set "ELECTRON=%RAIZ%desktop\node_modules\electron\dist\electron.exe"
if not exist "%ELECTRON%" goto :sin_app
if not exist "%PERFIL%\bin\ffmpeg.exe" goto :sin_ffmpeg

echo.
echo   %CN%%CC%►  ClipViral · Grabar video para Meta%C0%
echo.
echo   Se abre una ventana con los pasos. Puedes cerrar esta ventana negra.
start "" "%ELECTRON%" "%RAIZ%desktop\grabador"
timeout /t 3 >nul
exit /b 0

:sin_carpeta
echo.
echo   %CR%No encuentro la carpeta de ClipViral.%C0%
echo   Pon este archivo dentro de la carpeta de ClipViral (junto a "Iniciar ClipViral.bat").
echo.
pause
exit /b 1

:sin_app
echo.
echo   %CR%Falta preparar ClipViral en esta PC.%C0%
echo   Abre primero "Iniciar ClipViral.bat" una vez (instala lo necesario) y vuelve a intentar.
echo.
pause
exit /b 1

:sin_ffmpeg
echo.
echo   %CR%Falta FFmpeg (lo que graba la pantalla).%C0%
echo   Abre ClipViral una vez con "Iniciar ClipViral.bat": al empezar, te pide instalar lo que falta.
echo   Después vuelve a abrir este archivo.
echo.
pause
exit /b 1
