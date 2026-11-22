# Creates the local "gridcart" database and an app user, then writes backend\.env.
# Run: powershell -NoProfile -ExecutionPolicy Bypass -File D:\Project\backend\scripts\setup-db.ps1
$ErrorActionPreference = 'Stop'

$psql    = 'C:\Program Files\PostgreSQL\17\bin\psql.exe'
$envFile = Join-Path $PSScriptRoot '..\.env'
$dbName  = 'gridcart'
$appUser = 'gridcart_app'

if (-not (Test-Path $psql)) { throw "psql not found at $psql" }
if (Test-Path $envFile) { throw "$envFile already exists. Delete it first to recreate the database user." }

function New-RandomToken([int]$bytes) {
    $buf = New-Object byte[] $bytes
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buf)
    ([Convert]::ToBase64String($buf) -replace '[^A-Za-z0-9]', '')
}

function Invoke-Psql([string]$database, [string]$sql) {
    $ErrorActionPreference = 'Continue'
    $out = & $psql -h localhost -p 5432 -U postgres -d $database -v ON_ERROR_STOP=1 -tA -c $sql 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw "psql failed: $out" }
    $out.Trim()
}

$secure = Read-Host 'Enter the PostgreSQL superuser (postgres) password' -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try { $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }

$appPassword = New-RandomToken 24
$authSecret  = New-RandomToken 48

try {
    try { Invoke-Psql 'postgres' 'SELECT 1' | Out-Null }
    catch { throw 'Could not connect as postgres. Check the password and that the PostgreSQL service is running.' }

    $roleExists = Invoke-Psql 'postgres' "SELECT 1 FROM pg_roles WHERE rolname = '$appUser'"
    $verb = if ($roleExists -eq '1') { 'ALTER' } else { 'CREATE' }
    Invoke-Psql 'postgres' "$verb ROLE $appUser WITH LOGIN CREATEDB PASSWORD '$appPassword'" | Out-Null

    $dbExists = Invoke-Psql 'postgres' "SELECT 1 FROM pg_database WHERE datname = '$dbName'"
    if ($dbExists -ne '1') {
        Invoke-Psql 'postgres' "CREATE DATABASE $dbName OWNER $appUser TEMPLATE template0 ENCODING 'UTF8'" | Out-Null
    }
    Invoke-Psql $dbName 'CREATE EXTENSION IF NOT EXISTS pg_trgm' | Out-Null

    $env:PGPASSWORD = $appPassword
    $ErrorActionPreference = 'Continue'
    $who = (& $psql -h localhost -p 5432 -U $appUser -d $dbName -tA -c 'SELECT current_user' 2>&1 | Out-String).Trim()
    if ($who -ne $appUser) { throw "App user could not connect: $who" }
}
finally { $env:PGPASSWORD = $null }

$ErrorActionPreference = 'Stop'
$content = @"
NODE_ENV=development
PORT=4000
FRONTEND_URL=http://localhost:3000

DATABASE_URL=postgresql://${appUser}:${appPassword}@localhost:5432/${dbName}?schema=public
AUTH_SECRET=${authSecret}

RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=

CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
"@
[System.IO.File]::WriteAllText($envFile, ($content -replace "`r`n", "`n"), (New-Object System.Text.UTF8Encoding($false)))

Write-Host "Done. Database '$dbName' and user '$appUser' are ready, and backend\.env was written (contents not shown)."
