@echo off
setlocal

:: Check if running with Administrator privileges
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo Requesting Administrator privileges...
    powershell -NoProfile -Command "Start-Process cmd.exe -ArgumentList '/c \"\"%~dpnx0\"\"' -Verb RunAs"
    exit /b
)

title PostgreSQL Password Reset

set "HBA=C:\Program Files\PostgreSQL\18\data\pg_hba.conf"
set "BIN=C:\Program Files\PostgreSQL\18\bin"

echo ========================================================
echo  FlowLedger - PostgreSQL 18 Local Setup
echo ========================================================
echo.

if not exist "%HBA%" (
    echo [ERROR] pg_hba.conf not found at "%HBA%".
    pause
    exit /b 1
)

echo [1/5] Backing up pg_hba.conf...
copy /Y "%HBA%" "%HBA%.bak" >nul

echo [2/5] Enabling temporary trust authentication...
powershell -NoProfile -Command "(Get-Content '%HBA%') -replace 'host\s+all\s+all\s+(127\.0\.0\.1/32|::1/128)\s+scram-sha-256', 'host all all $1 trust' | Set-Content '%HBA%'"

echo [3/5] Restarting PostgreSQL service...
net stop postgresql-x64-18 >nul 2>&1
net start postgresql-x64-18

echo [4/5] Resetting 'postgres' password to 'password' and creating 'flowledger' database...
"%BIN%\psql.exe" -U postgres -c "ALTER USER postgres WITH PASSWORD 'password';"
"%BIN%\psql.exe" -U postgres -c "CREATE DATABASE flowledger;"

echo [5/5] Restoring original security configuration...
copy /Y "%HBA%.bak" "%HBA%" >nul
del "%HBA%.bak" >nul 2>&1
net stop postgresql-x64-18 >nul 2>&1
net start postgresql-x64-18

echo.
echo ========================================================
echo  SUCCESS!
echo  - User: postgres
echo  - Password: password
echo  - Database: flowledger
echo ========================================================
echo.
echo You can now close this window and run 'npm run dev'.
echo.
pause

