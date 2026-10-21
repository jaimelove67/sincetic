@echo off
cd /d "%~dp0"
echo.
echo   GeWu Science Atlas  /  LangChain + Qwen3.8-27B
echo   http://127.0.0.1:8000
echo.
start "" cmd /c "timeout /t 2 >nul & start http://127.0.0.1:8000"
python -m uvicorn app:app --host 127.0.0.1 --port 8000
