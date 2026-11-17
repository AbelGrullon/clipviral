@echo off
chcp 65001 >nul
setlocal EnableExtensions DisableDelayedExpansion
title ClipViral · Instalar en el VPS

rem En tu VPS con Windows: instala el servidor de ClipViral para que esté siempre encendido (aunque nadie esté
rem conectado al Escritorio remoto) y se encienda solo si el VPS se reinicia. Así publica lo programado aunque
rem tu PC esté apagada.  Clic derecho en este archivo y "Ejecutar como administrador".
rem También sirve para ACTUALIZARLO: descomprime la copia nueva encima de esta carpeta y vuelve a abrirlo.
rem Tus datos del VPS nunca se reemplazan con los de la copia.

for /f %%e in ('echo prompt $E^| cmd') do set "ESC=%%e"
set "C0=%ESC%[0m"
set "CN=%ESC%[1m"
set "CC=%ESC%[96m"
set "CG=%ESC%[90m"
set "CP=%ESC%[95m"
set "CR=%ESC%[91m"
set "CV=%ESC%[92m"

cd /d "%~dp0"
echo.
echo   %CP%╔════════════════════════════════════════════╗%C0%
echo   %CP%║%C0%  %CN%%CC%►  ClipViral · servidor en tu VPS%C0%          %CP%║%C0%
echo   %CP%╚════════════════════════════════════════════╝%C0%

net session >nul 2>nul
if errorlevel 1 goto :sin_admin
where node >nul 2>nul
if errorlevel 1 goto :sin_node
if not exist "server\scripts\vps.js" goto :sin_carpeta

echo.
echo     %CG%·%C0% Instalando lo que necesita el servidor (la primera vez tarda unos minutos)...
pushd server
call npm install --omit=dev --no-fund --no-audit --loglevel=error
set "ERR=%errorlevel%"
popd
if not "%ERR%"=="0" goto :fallo_instalar
echo     %CV%✔%C0% Listo.

pushd server
node --env-file-if-exists=.env --disable-warning=ExperimentalWarning scripts\vps.js
popd
goto :fin

:sin_admin
echo.
echo     %CR%✖%C0% Hay que abrirlo como administrador.
echo       Cierra esta ventana, haz clic derecho en "Instalar en el VPS.bat" y elige "Ejecutar como administrador".
goto :fin

:sin_node
echo.
echo     %CR%✖%C0% Falta Node.js en el VPS. Instala la versión LTS desde nodejs.org y vuelve a abrir este archivo.
start "" "https://nodejs.org/es/download"
goto :fin

:sin_carpeta
echo.
echo     %CR%✖%C0% Pon este archivo dentro de la carpeta de ClipViral (donde está la carpeta server) y ábrelo de nuevo.
goto :fin

:fallo_instalar
echo.
echo     %CR%✖%C0% No se pudo instalar lo que necesita el servidor. Revisa el internet del VPS y vuelve a abrir este archivo.

:fin
echo.
echo     %CG%Pulsa una tecla para cerrar.%C0%
pause >nul
endlocal
