@echo off
chcp 65001 >nul
setlocal EnableExtensions DisableDelayedExpansion
title ClipViral

rem ══════════════════════════════════════════════════════════════════════════
rem  ClipViral · arranque guiado. Doble clic y listo.
rem   Paso 1. Revisa tu PC (Node.js, memoria, espacio libre).
rem   Paso 2. Instala lo necesario (solo la primera vez).
rem   Paso 3. Tu cuenta: la primera vez crea el administrador y pide tu clave de Claude.
rem           Las demás veces te saluda y avisa si falta algo.
rem   Paso 4. Enciende el servidor y abre la app. Al cerrar la app, apaga el servidor
rem           si lo encendió este archivo.
rem  Si en la app elegiste tu VPS (Ajustes → Servidor de ClipViral), no enciende el servidor de esta PC:
rem  abre la app conectada al VPS.
rem  Opcional: "Iniciar ClipViral.bat" 4601 usa otro puerto.
rem  Para pruebas: CLIPVIRAL_PERFIL (carpeta de datos de la app) y CLIPVIRAL_APP_ARGS.
rem ══════════════════════════════════════════════════════════════════════════

rem Colores (Windows 10 y 11 los entienden).
for /f %%e in ('echo prompt $E^| cmd') do set "ESC=%%e"
set "C0=%ESC%[0m"
set "CV=%ESC%[92m"
set "CR=%ESC%[91m"
set "CA=%ESC%[93m"
set "CC=%ESC%[96m"
set "CG=%ESC%[90m"
set "CN=%ESC%[1m"
set "CP=%ESC%[95m"

rem Carpeta de datos de la app (ahí también se recuerda dónde está ClipViral).
set "PERFIL=%APPDATA%\ClipViral"
if defined CLIPVIRAL_PERFIL set "PERFIL=%CLIPVIRAL_PERFIL%"

rem Carpeta de ClipViral: la de este archivo o, si lo copiaste a otro lugar
rem (por ejemplo al escritorio), la de la última vez que se abrió.
set "RAIZ=%~dp0"
if exist "%RAIZ%server\package.json" goto :carpeta_ok
if exist "%PERFIL%\carpeta.txt" set /p "RAIZ=" <"%PERFIL%\carpeta.txt"
if not exist "%RAIZ%server\package.json" goto :sin_carpeta
:carpeta_ok
cd /d "%RAIZ%"

echo.
echo   %CP%╔════════════════════════════════════════════╗%C0%
echo   %CP%║%C0%  %CN%%CC%►  ClipViral%C0%                              %CP%║%C0%
echo   %CP%║%C0%  %CG%Clips virales de tus directos, en tu PC%C0%   %CP%║%C0%
echo   %CP%╚════════════════════════════════════════════╝%C0%

rem ── Paso 1. Tu PC ─────────────────────────────────────────────────────────
call :paso "█░░░" 1 "Revisando tu PC"
where node >nul 2>nul
if errorlevel 1 goto :sin_node
node server\scripts\revisar-pc.js
if errorlevel 3 goto :node_viejo
if errorlevel 1 goto :node_viejo

rem ── Paso 2. Lo que se instala una sola vez ────────────────────────────────
call :paso "██░░" 2 "Preparando ClipViral"
set "INSTALE=0"
if exist "server\.env" goto :env_ok
if not exist "server\.env.example" goto :env_ok
copy /y "server\.env.example" "server\.env" >nul
call :ok "Creé el archivo de ajustes del servidor (server\.env)."
:env_ok
rem npm deja node_modules\.package-lock.json al terminar: si no está, la instalación quedó a medias.
if exist "server\node_modules\.package-lock.json" goto :deps_app
call :instalar server "el servidor"
if errorlevel 1 goto :fallo_instalar
set "INSTALE=1"
:deps_app
rem Si falta algo que se agregó en una versión nueva (el detector de sonidos), se instala otra vez.
if exist "desktop\node_modules\.package-lock.json" if exist "desktop\node_modules\@huggingface\transformers\package.json" goto :deps_electron
call :instalar desktop "la app"
if errorlevel 1 goto :fallo_instalar
set "INSTALE=1"
:deps_electron
if exist "desktop\node_modules\electron\dist\electron.exe" goto :deps_listas
call :info "Descargando Electron, el motor de la app (unos 100 MB). Solo pasa la primera vez..."
pushd desktop
node node_modules\electron\install.js
popd
if not exist "desktop\node_modules\electron\dist\electron.exe" goto :sin_electron
call :ok "Electron listo."
set "INSTALE=1"
:deps_listas
if "%INSTALE%"=="0" call :ok "Todo está instalado."

rem ¿Elegiste tu VPS en la app? Entonces el servidor de esta PC no hace falta.
set "REMOTO="
for /f "usebackq delims=" %%u in (`node server\scripts\servidor-elegido.js "%PERFIL%"`) do set "REMOTO=%%u"
if defined REMOTO goto :remoto

rem ── Paso 3. Tu cuenta ─────────────────────────────────────────────────────
call :paso "███░" 3 "Tu cuenta"
set "NOMBRE="
set "CLIPVIRAL_NOMBRE_EN=%TEMP%\clipviral-nombre-%RANDOM%%RANDOM%.txt"
pushd server
node --env-file-if-exists=.env --disable-warning=ExperimentalWarning scripts\asistente.js
set "ERR=%errorlevel%"
popd
if exist "%CLIPVIRAL_NOMBRE_EN%" set /p "NOMBRE=" <"%CLIPVIRAL_NOMBRE_EN%"
del "%CLIPVIRAL_NOMBRE_EN%" >nul 2>nul
set "CLIPVIRAL_NOMBRE_EN="
if "%ERR%"=="2" goto :cancelado
if not "%ERR%"=="0" goto :fallo_cuenta

rem ── Paso 4. Servidor y app ────────────────────────────────────────────────
call :paso "████" 4 "Encendiendo ClipViral"
rem Puerto: el que pases al abrirlo (Iniciar ClipViral.bat 4601), o PORT de server\.env, o 4600.
set "PUERTO=4600"
for /f "tokens=1,* delims==" %%a in ('findstr /b /c:"PORT=" "server\.env" 2^>nul') do set "PUERTO=%%b"
if not "%~1"=="" set "PUERTO=%~1"
set "LOG=%RAIZ%server\servidor.log"
set "INICIE=0"
set "SALTOS=0"

:servidor
set "PORT=%PUERTO%"
call :estado
if "%ESTADO%"=="nuevo" goto :ya_abierto
if "%ESTADO%"=="viejo" goto :reiniciar
if "%ESTADO%"=="libre" goto :encender
rem Otra copia de ClipViral u otro programa usan el puerto: pruebo el siguiente.
set /a SALTOS+=1
if %SALTOS% gtr 10 goto :puerto_ocupado
if "%ESTADO%"=="otra" call :aviso "En el puerto %PUERTO% está abierta otra copia de ClipViral. Uso otro puerto."
if "%ESTADO%"=="ocupado" call :aviso "El puerto %PUERTO% lo usa otro programa. Uso otro puerto."
set /a PUERTO+=1
goto :servidor

:ya_abierto
call :ok "El servidor ya estaba encendido. Uso ese."
goto :app

:reiniciar
call :info "Hay una versión vieja del servidor abierta. La cierro para abrir la nueva..."
call :pid_puerto
if defined PID taskkill /PID %PID% /F >nul 2>nul
call :esperar_puerto_libre

:encender
start "" /b /d "%RAIZ%server" node --env-file-if-exists=.env --disable-warning=ExperimentalWarning src\index.js > "%LOG%" 2>&1
set "INICIE=1"
set /a INTENTOS=0
<nul set /p "=%C0%    %CG%·%C0% Encendiendo el servidor "
:esperando
ping -n 2 127.0.0.1 >nul
call :estado
if "%ESTADO%"=="nuevo" goto :encendido
<nul set /p "=%CG%.%C0%"
set /a INTENTOS+=1
if %INTENTOS% lss 40 goto :esperando
echo.
call :mal "El servidor no arrancó. Esto dice su registro:"
echo.
type "%LOG%"
echo.
call :solucion "Cierra esta ventana y vuelve a abrir ClipViral. Si se repite, manda una foto de este mensaje a quien te pasó la app."
goto :fallo

:encendido
echo  %CV%listo%C0%

:app
echo.
call :ok "Servidor:        %CC%http://localhost:%PUERTO%%C0%"
call :ok "Panel de admin:  %CC%http://localhost:%PUERTO%/admin/%C0%"
call :info "Abriendo la app..."
if "%INICIE%"=="1" call :info "No cierres esta ventana mientras uses ClipViral. Al cerrar la app, el servidor se apaga solo."
set "CLIPVIRAL_SERVER=http://localhost:%PUERTO%"
set "ARGS_APP="
if defined CLIPVIRAL_PERFIL set "ARGS_APP=--user-data-dir="%CLIPVIRAL_PERFIL%""
start "" /wait /d "%RAIZ%desktop" "%RAIZ%desktop\node_modules\electron\dist\electron.exe" . %ARGS_APP% %CLIPVIRAL_APP_ARGS%
echo.
call :info "La app se cerró."
if not "%INICIE%"=="1" goto :adios
<nul set /p "=%C0%    %CG%·%C0% Apagando el servidor "
call :pid_puerto
if defined PID taskkill /PID %PID% /F >nul 2>nul
echo %CV%listo%C0%

:adios
set "DESPEDIDA=¡Hasta pronto!"
if defined NOMBRE set "DESPEDIDA=¡Hasta pronto, %NOMBRE%!"
echo.
echo     %CP%%DESPEDIDA%%C0%
ping -n 3 127.0.0.1 >nul
endlocal
exit /b 0

rem ── Con el servidor en tu VPS ─────────────────────────────────────────────
:remoto
call :paso "███░" 3 "Tu servidor"
call :ok "Usas el servidor de tu VPS: %CC%%REMOTO%%C0%"
call :info "No hace falta encender el servidor de esta PC: lo programado lo publica el VPS."
node server\scripts\servidor-elegido.js "%PERFIL%" --probar
if errorlevel 1 goto :remoto_callado
call :ok "Tu VPS contesta."
goto :remoto_app
:remoto_callado
call :aviso "Tu VPS no contesta ahora. Abro la app igual. Si sigue así, revisa el VPS o vuelve al servidor de esta PC en Ajustes."
:remoto_app
call :paso "████" 4 "Abriendo ClipViral"
set "CLIPVIRAL_SERVER=%REMOTO%"
set "ARGS_APP="
if defined CLIPVIRAL_PERFIL set "ARGS_APP=--user-data-dir="%CLIPVIRAL_PERFIL%""
start "" /wait /d "%RAIZ%desktop" "%RAIZ%desktop\node_modules\electron\dist\electron.exe" . %ARGS_APP% %CLIPVIRAL_APP_ARGS%
echo.
call :info "La app se cerró."
goto :adios

rem ── Problemas y qué hacer ─────────────────────────────────────────────────
:sin_carpeta
echo.
call :mal "No encuentro la carpeta de ClipViral."
call :solucion "Pon este archivo dentro de la carpeta de ClipViral (donde están las carpetas server y desktop) y ábrelo de nuevo."
goto :fallo

:sin_node
call :mal "Falta Node.js, el programa que hace funcionar a ClipViral."
call :solucion "Instálalo desde nodejs.org (el botón LTS, versión 22 o más nueva). Cuando termine, cierra esta ventana y vuelve a abrir ClipViral."
call :abrir_pagina "https://nodejs.org/es/download"
goto :fallo

:node_viejo
for /f %%v in ('node -v') do set "NODEV=%%v"
call :mal "Tienes Node.js %NODEV% y ClipViral necesita la versión 22.13 o más nueva."
call :solucion "Instala la versión LTS desde nodejs.org (se instala encima, no pierdes nada). Después vuelve a abrir ClipViral."
call :abrir_pagina "https://nodejs.org/es/download"
goto :fallo

:fallo_instalar
call :mal "No se pudo instalar lo que necesita ClipViral."
call :solucion "Revisa tu internet y vuelve a abrir este archivo. Si sigue igual, borra las carpetas node_modules que están dentro de server y desktop, y prueba otra vez."
goto :fallo

:sin_electron
call :mal "No se pudo descargar Electron, el motor de la app."
call :solucion "Revisa tu internet (o desactiva un momento el antivirus) y vuelve a abrir este archivo."
goto :fallo

:fallo_cuenta
call :mal "No pude revisar tu cuenta."
call :solucion "Cierra esta ventana y vuelve a abrir ClipViral. Si se repite, manda una foto de este mensaje a quien te pasó la app."
goto :fallo

:puerto_ocupado
call :mal "Todos los puertos del %PUERTO% para atrás están ocupados."
call :solucion "Reinicia la PC y vuelve a abrir ClipViral."
goto :fallo

:cancelado
echo.
echo     %CG%Pulsa una tecla para cerrar.%C0%
pause >nul
endlocal
exit /b 2

:fallo
echo.
echo     %CG%Pulsa una tecla para cerrar.%C0%
pause >nul
endlocal
exit /b 1

rem ── Ayudantes ─────────────────────────────────────────────────────────────

rem call :paso "<barra>" <número> "<título>"
:paso
echo.
echo   %CP%%~1%C0%  %CN%Paso %~2 de 4 · %~3%C0%
exit /b 0

:ok
echo     %CV%✔%C0% %~1
exit /b 0

:info
echo     %CG%·%C0% %~1
exit /b 0

:aviso
echo     %CA%!%C0% %~1
exit /b 0

:mal
echo     %CR%✖%C0% %~1
exit /b 0

:solucion
echo       %CC%→ Qué hacer:%C0% %~1
exit /b 0

rem Pregunta si abre una página en el navegador: call :abrir_pagina "https://..."
:abrir_pagina
choice /c SN /n /m "      ¿Abro la página ahora? [S/N] "
if errorlevel 2 exit /b 0
start "" "%~1"
exit /b 0

rem Instala las dependencias de una carpeta: call :instalar <carpeta> "<nombre>"
:instalar
call :info "Instalando lo que necesita %~2. Solo pasa la primera vez y tarda unos minutos..."
pushd "%RAIZ%%~1"
call npm install --no-fund --no-audit --loglevel=error
set "ERR=%errorlevel%"
popd
if "%ERR%"=="0" call :ok "Listo: %~2."
exit /b %ERR%

rem Deja en ESTADO: libre, nuevo (este servidor, al día), viejo, otra (otra copia de ClipViral) u ocupado.
:estado
set "ESTADO=libre"
for /f %%s in ('node server\scripts\estado-servidor.js %PUERTO% 2^>nul') do set "ESTADO=%%s"
exit /b 0

rem Deja en PID el programa que escucha en el puerto (vacío si no hay ninguno).
:pid_puerto
set "PID="
for /f "tokens=1,2,3,5" %%a in ('netstat -ano') do (
  if "%%b"=="0.0.0.0:%PUERTO%" if "%%c"=="0.0.0.0:0" set "PID=%%d"
  if "%%b"=="127.0.0.1:%PUERTO%" if "%%c"=="0.0.0.0:0" set "PID=%%d"
  if "%%b"=="[::]:%PUERTO%" if "%%c"=="[::]:0" set "PID=%%d"
)
exit /b 0

:esperar_puerto_libre
for /l %%i in (1,1,10) do (
  call :pid_puerto
  if not defined PID exit /b 0
  ping -n 2 127.0.0.1 >nul
)
exit /b 0
