@echo off
chcp 65001 >nul
setlocal EnableExtensions DisableDelayedExpansion
title ClipViral · Copia para tu VPS

rem Arma "ClipViral para el VPS (PRIVADO).zip" en tu escritorio: el servidor y TUS datos (tu cuenta, tus redes
rem conectadas y tu clave de Claude), para que tu VPS publique lo programado aunque tu PC esté apagada.
rem Es PRIVADA: no se la pases a nadie y bórrala después de instalar. Los pasos están en GUIA-VPS.md.

for /f %%e in ('echo prompt $E^| cmd') do set "ESC=%%e"
set "C0=%ESC%[0m"
set "CN=%ESC%[1m"
set "CC=%ESC%[96m"
set "CG=%ESC%[90m"
set "CP=%ESC%[95m"
set "CR=%ESC%[91m"

cd /d "%~dp0"
echo.
echo   %CP%╔════════════════════════════════════════════╗%C0%
echo   %CP%║%C0%  %CN%%CC%►  ClipViral · copia para tu VPS%C0%           %CP%║%C0%
echo   %CP%╚════════════════════════════════════════════╝%C0%
echo.

where node >nul 2>nul
if errorlevel 1 goto :sin_node
if not exist "server\scripts\preparar-vps.js" goto :sin_carpeta

pushd server
node --env-file-if-exists=.env --disable-warning=ExperimentalWarning scripts\preparar-vps.js
set "ERR=%errorlevel%"
popd
if not "%ERR%"=="0" goto :fin

echo.
echo   %CN%Qué sigue:%C0%
echo     1. Entra a tu VPS con Escritorio remoto.
echo     2. Copia el zip (clic derecho, Copiar aquí y Pegar allá) y descomprímelo en C:\ (queda C:\ClipViral).
echo     3. Allá, clic derecho en "Instalar en el VPS.bat" y Ejecutar como administrador.
echo     4. Cuando termine, borra el zip de esta PC y del VPS: tiene tus conexiones.
echo.
echo   %CG%Todos los pasos, con la dirección con candado (https), están en GUIA-VPS.md.%C0%
goto :fin

:sin_node
echo     %CR%✖%C0% Falta Node.js. Instálalo desde nodejs.org y vuelve a abrir este archivo.
goto :fin

:sin_carpeta
echo     %CR%✖%C0% Pon este archivo dentro de la carpeta de ClipViral y ábrelo de nuevo.

:fin
echo.
echo     %CG%Pulsa una tecla para cerrar.%C0%
pause >nul
endlocal
