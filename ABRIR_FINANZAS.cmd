@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Necesitas Node.js para abrir la aplicacion.
  pause
  exit /b 1
)
if not exist "backend\node_modules\express" call npm ci --prefix backend --no-audit --no-fund
if not exist "frontend\node_modules\vite" call npm ci --prefix frontend --no-audit --no-fund
if not exist "frontend\dist\index.html" call npm run build --prefix frontend
echo.
echo Gema Finanzas - demostracion local con datos ficticios.
echo Abre http://127.0.0.1:4178/finanzas en tu navegador.
echo Esta ventana mantiene la aplicacion funcionando. Ctrl+C para cerrarla.
echo.
node backend\scripts\finance-preview.mjs
pause
