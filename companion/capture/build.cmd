@echo off
rem Builds mqcapture.exe with the MSVC Build Tools (found via vswhere). Output: companion\capture\bin\mqcapture.exe
setlocal
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
for /f "usebackq delims=" %%i in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`) do set "VS=%%i"
if not defined VS (echo MSVC Build Tools not found & exit /b 1)
call "%VS%\VC\Auxiliary\Build\vcvars64.bat" >nul || exit /b 1
cd /d "%~dp0"
if not exist bin mkdir bin
cl /nologo /std:c++20 /O2 /EHsc /MT /W4 /permissive- /utf-8 /DUNICODE /D_UNICODE /DNOMINMAX mqcapture.cpp /Fobin\ /Febin\mqcapture.exe /link mmdevapi.lib ole32.lib || exit /b 1
echo built %~dp0bin\mqcapture.exe
