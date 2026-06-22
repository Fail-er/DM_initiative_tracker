@echo off
REM ============================================================
REM start-server.bat
REM Spusti lokalni HTTP server pro DM Encounter Tracker a otevre
REM aplikaci v vychozim prohlizeci.
REM
REM Proc je server potreba: nektere funkce (Player View okno,
REM import sample dat) vyzaduji http:// origin, ne file://.
REM Chovani se lisi prohlizec od prohlizece -- Firefox to vyzaduje
REM vzdy, Edge to ve vetsine pripadu toleruje i bez serveru, ale
REM server je spolehlive reseni napric vsemi prohlizeci.
REM ============================================================

setlocal enabledelayedexpansion
set PORT=8000
set PYTHON_CMD=

REM Prejde do slozky, ve ktere tento .bat soubor lezi (tedy do
REM root slozky projektu), bez ohledu na to, odkud byl spusten.
cd /d "%~dp0"

echo.
echo Hledam Python...

REM Zkousi najit funkcni Python interpreter. Na nekterych Windows
REM instalacich je "python" jen Microsoft Store alias-stub, ktery
REM "existuje" (where ho najde), ale nefunguje jako skutecny
REM interpreter -- proto kazdou kandidatni cestu i SKUTECNE
REM ZKOUSIME spustit (--version), ne jen overujeme jeji existenci.

python --version >nul 2>nul
if not errorlevel 1 (
    set PYTHON_CMD=python
    echo Nalezen: python
    goto :found
)

py --version >nul 2>nul
if not errorlevel 1 (
    set PYTHON_CMD=py
    echo Nalezen: py
    goto :found
)

py -3 --version >nul 2>nul
if not errorlevel 1 (
    set PYTHON_CMD=py -3
    echo Nalezen: py -3
    goto :found
)

echo.
echo CHYBA: Funkcni Python nebyl nalezen.
echo.
echo Pokud na svem PC Python nemas, stahni a nainstaluj ho z:
echo   https://www.python.org/downloads/
echo Pri instalaci NEZAPOMEN zaskrtnout "Add python.exe to PATH".
echo.
echo Pokud Python mas, ale prikaz "python" v cmd otevira Microsoft
echo Store namisto spusteni Pythonu, jde o znamy problem s Windows
echo App Execution Aliases. Reseni:
echo   Nastaveni -^> Aplikace -^> Rozsirene moznosti aplikaci
echo   -^> Spravovat alias pro spousteni aplikaci -^> vypni "python.exe"
echo   a "python3.exe", pokud tam jsou.
echo.
pause
exit /b 1

:found
echo.
echo Spoustim lokalni server na portu %PORT% pomoci: %PYTHON_CMD%
echo Aplikace se otevre v prohlizeci za chvili.
echo.
echo Pro zastaveni serveru zavri toto okno nebo stiskni Ctrl+C.
echo.

REM Otevre prohlizec po kratke prodleve, at server stihne nabehnout
REM driv, nez se na nej prohlizec pokusi pripojit.
start /min cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:%PORT%/index.html"

%PYTHON_CMD% -m http.server %PORT%

REM Pokud se sem dostaneme, server se zastavil (Ctrl+C nebo padl).
REM Necha okno otevrene, at je videt posledni vypis / pripadnou chybu,
REM namisto aby se cmd okno hned tise zavrelo.
echo.
echo Server byl zastaven.
pause

endlocal
