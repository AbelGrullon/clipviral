@echo off
chcp 65001 >nul
setlocal EnableExtensions DisableDelayedExpansion
title ClipViral · Bot de Discord

rem Enciende el bot de Discord de ClipViral en ESTA ventana: mientras esté abierta, el bot atiende los tickets.
rem La primera vez te pide el token del bot (los pasos están en GUIA-DISCORD.md).
rem Para que esté siempre encendido, instálalo en el VPS con "Instalar bot de Discord en el VPS.bat".

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
echo   %CP%║%C0%  %CN%%CC%►  ClipViral · bot de Discord%C0%             %CP%║%C0%
echo   %CP%╚════════════════════════════════════════════╝%C0%

where node >nul 2>nul
if errorlevel 1 goto :sin_node
if not exist "discord-bot\src\index.js" goto :sin_carpeta

pushd discord-bot
if exist "node_modules\discord.js\package.json" goto :instalado
echo.
echo     %CG%·%C0% Instalando lo que necesita el bot (solo la primera vez)...
call npm install --omit=dev --no-fund --no-audit --loglevel=error
if errorlevel 1 goto :fallo_instalar
echo     %CV%✔%C0% Listo.

:instalado
findstr /r /c:"^DISCORD_TOKEN=..*" ".env" >nul 2>nul
if errorlevel 1 goto :configurar
echo.
echo     %CG%Pulsa C para cambiar el token o la dirección del servidor, o espera y el bot se enciende solo.%C0%
choice /c EC /t 6 /d E /n >nul
if errorlevel 2 goto :configurar
goto :encender

:configurar
node scripts\configurar.js
if errorlevel 1 goto :fin_carpeta
findstr /r /c:"^DISCORD_TOKEN=..*" ".env" >nul 2>nul
if errorlevel 1 goto :fin_carpeta

:encender
echo.
echo   %CN%Bot encendido.%C0% Deja esta ventana abierta (puedes minimizarla). Para apagarlo, ciérrala.
echo   %CG%Si ya lo instalaste en el VPS, no lo enciendas también aquí: cierra esta ventana.%C0%
echo.
node --env-file-if-exists=.env src\index.js
echo.
echo     %CR%●%C0% El bot se apagó. Lee el último mensaje de arriba para saber por qué.
goto :fin_carpeta

:fallo_instalar
echo.
echo     %CR%✖%C0% No se pudo instalar lo que necesita el bot. Revisa el internet y vuelve a abrir este archivo.
goto :fin_carpeta

:sin_node
echo.
echo     %CR%✖%C0% Falta Node.js. Instala la versión LTS desde nodejs.org y vuelve a abrir este archivo.
goto :fin

:sin_carpeta
echo.
echo     %CR%✖%C0% Pon este archivo dentro de la carpeta de ClipViral (donde está la carpeta discord-bot) y ábrelo de nuevo.
goto :fin

:fin_carpeta
popd

:fin
echo.
echo     %CG%Pulsa una tecla para cerrar.%C0%
pause >nul
endlocal
