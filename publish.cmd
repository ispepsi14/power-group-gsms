@echo off
setlocal
cd /d "%~dp0"

for /f %%i in ('git branch --show-current') do set BRANCH=%%i
if /I not "%BRANCH%"=="main" (
  echo ERROR: Current branch is %BRANCH%. Switch to main first.
  exit /b 1
)

echo [1/4] Checking GitHub...
git fetch origin
if errorlevel 1 exit /b 1

for /f %%i in ('git rev-list --count HEAD..origin/main') do set BEHIND=%%i
if not "%BEHIND%"=="0" (
  echo ERROR: GitHub main has newer commits.
  echo Run: git pull --rebase origin main
  exit /b 1
)

echo [2/4] Staging public\index.html...
git add -- public\index.html

git diff --cached --quiet
if not errorlevel 1 (
  echo No changes to publish.
  exit /b 0
)

set "MSG=%~1"
if "%MSG%"=="" set "MSG=Update app"

echo [3/4] Committing...
git commit -m "%MSG%"
if errorlevel 1 exit /b 1

echo [4/4] Pushing to main...
git push origin main
if errorlevel 1 exit /b 1

echo.
echo DONE - GitHub Actions will deploy Firebase Hosting automatically.
