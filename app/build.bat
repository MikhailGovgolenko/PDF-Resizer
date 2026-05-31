@echo off
setlocal enabledelayedexpansion

echo ============================
echo    PDF Converter BUILD
echo ============================
echo.

:: ================= SETTINGS =================
set "APP=PDF Converter.py"
set "NAME=PDF Converter"
set "ICON=icon.ico"

:: ================= CLEANUP =================
echo Cleaning old build...
rmdir /s /q build 2>nul
rmdir /s /q dist 2>nul
del /q "%NAME%.spec" 2>nul

echo.
echo Building EXE with PyInstaller...

:: ================= PYINSTALLER =================
py -m PyInstaller ^
  --onefile ^
  --windowed ^
  --clean ^
  --noconfirm ^
  --icon "%ICON%" ^
  --add-data "icon.ico;." ^
  --add-data "icon.png;." ^
  --name "%NAME%" ^
  "%APP%"

:: ================= RESULT =================
echo.
echo ============================
echo BUILD FINISHED!
echo ============================
if exist "dist\%NAME%.exe" (
    echo ✅ EXE created successfully:
    echo    dist\%NAME%.exe
) else (
    echo ❌ Build failed!
)

echo.
pause