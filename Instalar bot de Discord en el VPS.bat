@echo off
chcp 65001 >nul
setlocal EnableExtensions DisableDelayedExpansion
title ClipViral · Bot de Discord en el VPS

rem En tu VPS con Windows: instala el bot de Discord de ClipViral para que esté siempre encendido (aunque nadie
rem esté conectado al Escritorio remoto) y se encienda solo si el VPS se reinicia.
rem Clic derecho en este archivo y "Ejecutar como administrador".
rem También sirve para ACTUALIZARLO o cambiar el token: vuelve a abrirlo igual.

for /f %%e in ('echo prompt $E^| cmd') do set "ESC=%%e"
set "C0=%ESC%[0m"
set "CG=%ESC%[90m"
set "CR=%ESC%[91m"
set "CV=%ESC%[92m"

cd /d "%~dp0"

net session >nul 2>nul
if errorlevel 1 goto :sin_admin
where node >nul 2>nul
if errorlevel 1 goto :sin_node
if not exist "discord-bot\scripts\configurar.js" goto :sin_carpeta

echo.
echo     %CG%·%C0% Instalando lo que necesita el bot (la primera vez tarda un poco)...
pushd discord-bot
call npm install --omit=dev --no-fund --no-audit --loglevel=error
set "ERR=%errorlevel%"
popd
if not "%ERR%"=="0" goto :fallo_instalar
echo     %CV%✔%C0% Listo.

pushd discord-bot
node scripts\configurar.js --vps
popd
goto :fin

:sin_admin
echo.
echo     %CR%✖%C0% Hay que abrirlo como administrador.
echo       Cierra esta ventana, haz clic derecho en "Instalar bot de Discord en el VPS.bat" y elige "Ejecutar como administrador".
goto :fin

:sin_node
echo.
echo     %CR%✖%C0% Falta Node.js en el VPS. Instala la versión LTS desde nodejs.org y vuelve a abrir este archivo.
start "" "https://nodejs.org/es/download"
goto :fin

:sin_carpeta
echo.
echo     %CR%✖%C0% Pon este archivo dentro de la carpeta de ClipViral (donde está la carpeta discord-bot) y ábrelo de nuevo.
goto :fin

:fallo_instalar
echo.
echo     %CR%✖%C0% No se pudo instalar lo que necesita el bot. Revisa el internet del VPS y vuelve a abrir este archivo.

:fin
echo.
echo     %CG%Pulsa una tecla para cerrar.%C0%
pause >nul
endlocal
