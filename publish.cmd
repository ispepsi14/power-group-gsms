@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ============================================
echo   POWER GROUP GSMS - publish to GitHub
echo ============================================
echo.

rem 15 ต.ค. 2026 - เดิมสคริปต์นี้ใช้ exit /b 1 ทุกจุดที่ error
rem พอดับเบิลคลิกจากหน้าต่าง Explorer หน้าต่าง CMD จะปิดทันทีที่สคริปต์จบ
rem ข้อความ ERROR จึงวาบแล้วหายไป อ่านไม่ทัน = "CMD ใช้ไม่ได้"
rem ตอนนี้ทุกทางออกไปจบที่ :fail / :done ซึ่ง pause ค้างไว้ให้อ่านก่อนเสมอ

echo [0/4] Checking that git is installed...
where git >nul 2>nul
if errorlevel 1 (
  echo.
  echo ERROR: ไม่พบคำสั่ง git บนเครื่องนี้
  echo        ติดตั้งจาก https://git-scm.com/download/win
  echo        ติดตั้งเสร็จต้องปิดหน้าต่างนี้แล้วเปิดใหม่ PATH ถึงจะอัปเดต
  goto :fail
)
git --version

set "BRANCH="
for /f %%i in ('git branch --show-current 2^>nul') do set "BRANCH=%%i"
if not defined BRANCH (
  echo.
  echo ERROR: อ่านชื่อ branch ไม่ได้ - โฟลเดอร์นี้อาจไม่ใช่ git repo
  echo        ตำแหน่งที่รันอยู่: %CD%
  goto :fail
)
if /I not "%BRANCH%"=="main" (
  echo.
  echo ERROR: ตอนนี้อยู่ branch "%BRANCH%" ไม่ใช่ main
  echo        สั่ง: git checkout main
  goto :fail
)

echo.
echo [1/4] Checking GitHub...
git fetch origin
if errorlevel 1 (
  echo.
  echo ERROR: ติดต่อ GitHub ไม่ได้ - เช็กอินเทอร์เน็ต หรือการล็อกอิน git
  goto :fail
)

set "BEHIND=0"
for /f %%i in ('git rev-list --count HEAD..origin/main 2^>nul') do set "BEHIND=%%i"
if not "%BEHIND%"=="0" (
  echo.
  echo ERROR: บน GitHub มี commit ใหม่กว่าในเครื่อง %BEHIND% ตัว
  echo        สั่ง: git pull --rebase origin main
  goto :fail
)

rem 25 ก.ย. 2026 - เดิมบรรทัดนี้ stage แค่ public\index.html ไฟล์เดียว
rem เมื่อมีไฟล์ใหม่ในโฟลเดอร์ public (version.json, firebase-messaging-sw.js)
rem มันจึงไม่ถูก commit และไม่เคยขึ้นเซิร์ฟเวอร์ ทั้งที่อยู่ในเครื่องแล้ว
rem -A = เอาทั้งของใหม่ ของที่แก้ และของที่ลบ
rem
rem 5 ต.ค. 2026 - เพิ่ม firebase.json กับ firestore.rules เข้ามาด้วย
rem firebase.json อยู่นอกโฟลเดอร์ public แต่เป็นตัวคุม Cache-Control ของเว็บ
rem ถ้าไม่ stage มาด้วย การแก้เรื่องแคชจะไม่มีวันขึ้นเซิร์ฟเวอร์ - เป็นกับดัก
rem ตัวเดียวกับที่ทำให้ version.json หายไปสองสัปดาห์
echo.
echo [2/4] Staging public\ + firebase.json + firestore.rules ...
git add -A -- public firebase.json firestore.rules
if errorlevel 1 goto :fail

git diff --cached --quiet
if not errorlevel 1 (
  echo.
  echo ไม่มีอะไรเปลี่ยน - ไม่ต้อง publish
  goto :done
)

echo.
echo ไฟล์ที่จะขึ้น GitHub รอบนี้:
git diff --cached --name-status
echo.

set "MSG=%~1"
if "%MSG%"=="" set "MSG=Update app"

echo [3/4] Committing...
git commit -m "%MSG%"
if errorlevel 1 goto :fail

echo.
echo [4/4] Pushing to main...
git push origin main
if errorlevel 1 (
  echo.
  echo ERROR: push ไม่สำเร็จ - ถ้าถามรหัสผ่าน ให้พิมพ์เองในหน้าต่างนี้
  goto :fail
)

echo.
echo ============================================
echo   DONE - GitHub Actions จะ deploy ให้เอง
echo   รอสักครู่แล้วเช็กที่
echo   https://github.com/ispepsi14/power-group-gsms/actions
echo ============================================

:done
echo.
pause
exit /b 0

:fail
echo.
echo *** หยุดการทำงาน - ยังไม่มีอะไรถูก push ***
echo.
pause
exit /b 1
