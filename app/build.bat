@echo off
setlocal enabledelayedexpansion

echo ====================================
echo       PDF Converter SMART BUILD
echo ====================================
echo.

:: ================= НАСТРОЙКИ ПУТЕЙ =================
set "APP=PDF Converter.py"
set "NAME=PDF Converter"
set "ICON=icon.ico"
set "PNG=icon.png"
set "GS=gswin64c.exe"
set "GS_DLL=gsdll64.dll"

:: ================= ПРОВЕРКА ФАЙЛОВ ПЕРЕД СБОРКОЙ =================
echo Checking required files...

if not exist "%APP%" (
    echo ❌ ERROR: Script "%APP%" not found!
    goto :failed
)
if not exist "%ICON%" (
    echo ❌ ERROR: Icon "%ICON%" not found!
    goto :failed
)
if not exist "%PNG%" (
    echo ❌ ERROR: Icon "%PNG%" not found!
    goto :failed
)
if not exist "%GS%" (
    echo ❌ ERROR: Ghostscript "%GS%" not found!
    goto :failed
)
if not exist "%GS_DLL%" (
    echo ❌ ERROR: Ghostscript DLL "%GS_DLL%" not found!
    echo          Please copy gsdll64.dll from Ghostscript bin folder into "app".
    goto :failed
)

echo ✅ All files found. Ready to build.
echo.

:: ================= ОЧИСТКА СТАРЫХ СБОРОК =================
echo Cleaning old build folders...
rmdir /s /q build 2>nul
rmdir /s /q dist 2>nul
del /q "%NAME%.spec" 2>nul

echo.
echo Building standalone EXE with PyInstaller...
echo Please wait...
echo.

:: ================= СБОРКА PYINSTALLER =================
py -m PyInstaller ^
  --onefile ^
  --windowed ^
  --clean ^
  --noconfirm ^
  --icon "%ICON%" ^
  --add-data "%ICON%;." ^
  --add-data "%PNG%;." ^
  --add-data "%GS%;." ^
  --add-data "%GS_DLL%;." ^
  --name "%NAME%" ^
  "%APP%"

:: ================= ПРОВЕРКА РЕЗУЛЬТАТА =================
echo.
echo ====================================
echo            BUILD FINISHED!
echo ====================================
if exist "dist\%NAME%.exe" (
    echo ✅ EXE created successfully:
    echo     app\dist\%NAME%.exe
) else (
    echo ❌ Build failed!
)

goto :end

:failed
echo.
echo ❌ Build canceled due to missing files.
echo.

:end
pause