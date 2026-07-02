@echo off
cd /d "%~dp0"
echo Subiendo cambios de PROMOTERS a GitHub...
git push origin main
echo.
echo Si no hubo errores, Render empezara el despliegue automaticamente.
echo Puedes cerrar esta ventana cuando termine.
pause
