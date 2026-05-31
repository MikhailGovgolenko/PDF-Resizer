@echo off
setlocal enabledelayedexpansion

echo ====================================
echo       PDF Converter SMART BUILD
echo ====================================
echo.

:: ================= НАСТРОЙКИ ПУТЕЙ =================
:: Теперь батник лежит внутри app, поэтому пути указываем напрямую
set "APP=PDF Converter.py"
set "NAME=PDF Converter"
set "ICON=icon.ico"
set "PNG=icon.png"
set "GS=gswin64c.exe"

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
    echo          Please ensure gswin64c.exe is in this folder.
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
echo Please wait, this might take a minute...
echo.

:: ================= СБОРКА PYINSTALLER =================
:: Так как файлы лежат в той же папке, мы просто упаковываем их через ";."
py -m PyInstaller ^
  --onefile ^
  --windowed ^
  --clean ^
  --noconfirm ^
  --icon "%ICON%" ^
  --add-data "%ICON%;." ^
  --add-data "%PNG%;." ^
  --add-data "%GS%;." ^
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
    echo.
    echo You can now take this EXE and run it on any PC!
) else (
    echo ❌ Build failed! Check PyInstaller logs above.
)

goto :end

:failed
echo.
echo ❌ Build canceled due to missing files.
echo.

:end
pause