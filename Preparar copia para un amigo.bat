@echo off
chcp 65001 >nul
setlocal EnableExtensions DisableDelayedExpansion
title ClipViral · Copia para un amigo

rem Arma "ClipViral para un amigo.zip" en tu escritorio: solo el programa, sin tus datos.
rem Fuera quedan: tu base de datos y cuentas, tu clave de Claude, server\.env, tokens de redes,
rem registros, clips y node_modules (en la otra PC se instala solo).

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
echo   %CP%║%C0%  %CN%%CC%►  ClipViral · copia para un amigo%C0%        %CP%║%C0%
echo   %CP%╚════════════════════════════════════════════╝%C0%
echo.

where node >nul 2>nul
if errorlevel 1 goto :sin_node
if not exist "server\scripts\preparar-copia.js" goto :sin_carpeta

node server\scripts\preparar-copia.js
if errorlevel 1 goto :fin

echo.
echo   %CN%Cómo se la pasas:%C0%
echo     1. Mándale el zip (WhatsApp, Drive, USB...).
echo     2. Tu amigo lo descomprime (clic derecho, Extraer todo).
echo     3. Abre la carpeta ClipViral y hace doble clic en "Iniciar ClipViral".
echo     4. La primera vez crea su cuenta y pega SU clave de Claude. Cada uno paga lo suyo.
echo.
echo   %CG%Necesita Windows 10 u 11, internet la primera vez y Node.js 22 o más nuevo (nodejs.org).%C0%
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
