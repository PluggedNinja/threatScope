@echo off
REM ============================================================
REM  THREATSCOPE - Agente de campo (Windows)
REM  Duplo-clique para iniciar. Para o honeypot na porta 22,
REM  rode como ADMINISTRADOR (botao direito > Executar como admin).
REM  Sem admin? Use HONEYPOT_PORT=2222 no .env.
REM ============================================================
REM UTF-8 no console para acentos e molduras aparecerem certos.
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [!] Node.js 18+ nao encontrado. Instale em https://nodejs.org e tente de novo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Instalando dependencias ^(uma vez^)...
  call npm install --omit=optional
)

echo.
echo Iniciando agente THREATSCOPE... (Ctrl+C para parar)
echo.
node agent.js
pause
