@echo off
setlocal

:: Folder where this .bat file is located
set "SCRIPT_DIR=%~dp0"

echo Enter PDF file name (example: input.pdf)
set /p "INPUT_FILE=File name: "

:: Full input file path
set "INPUT_PATH=%SCRIPT_DIR%%INPUT_FILE%"

:: Check if file exists
if not exist "%INPUT_PATH%" (
    echo.
    echo File not found!
    pause
    exit /b
)

echo.
echo Enter output PDF file name (example: out.pdf)
set /p "OUTPUT_FILE=Output file name: "

:: If empty -> default name
if "%OUTPUT_FILE%"=="" set "OUTPUT_FILE=out.pdf"

:: Full output file path
set "OUTPUT_PATH=%SCRIPT_DIR%%OUTPUT_FILE%"

echo.
echo Enter aspect ratio as two numbers.
echo Example for 2:3 page ratio: width=2, height=3
echo.

set /p "W_RATIO=Width: "
set /p "H_RATIO=Height: "

:: Validate input
if "%W_RATIO%"=="" (
    echo Width is empty!
    pause
    exit /b
)

if "%H_RATIO%"=="" (
    echo Height is empty!
    pause
    exit /b
)

:: Base width in PDF points
set "BASE_WIDTH=1440"

:: Calculate height
set /a HEIGHT=BASE_WIDTH * H_RATIO / W_RATIO

echo.
echo Summary:
echo Input: %INPUT_PATH%
echo Output: %OUTPUT_PATH%
echo Width: %BASE_WIDTH%
echo Height: %HEIGHT%
echo.

pause

:: Run :contentReference[oaicite:0]{index=0}
"C:\Program Files\gs\gs10.06.0\bin\gswin64c.exe" ^
-sDEVICE=pdfwrite ^
-dNOPAUSE ^
-dBATCH ^
-dFIXEDMEDIA ^
-dDEVICEWIDTHPOINTS=%BASE_WIDTH% ^
-dDEVICEHEIGHTPOINTS=%HEIGHT% ^
-dPDFFitPage ^
-sOutputFile="%OUTPUT_PATH%" ^
"%INPUT_PATH%"

if errorlevel 1 (
    echo.
    echo Error during PDF processing!
    pause
    exit /b
)

echo.
echo Done!
pause