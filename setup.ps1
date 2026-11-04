# One-time setup for the Ally / LifeOS API on Windows. Safe to run again.
# Run with: powershell -ExecutionPolicy Bypass -File setup.ps1
# It uses a local Docker database, so it never runs migrations against Neon
# unless you point DATABASE_URL at Neon yourself.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

function Step($message) { Write-Host "`n==> $message" -ForegroundColor Cyan }
function Run($command, [string[]]$arguments) {
    & $command @arguments
    if ($LASTEXITCODE -ne 0) { throw "Failed: $command $($arguments -join ' ')" }
}
function Require($command, $wingetId) {
    if (Get-Command $command -ErrorAction SilentlyContinue) { return }
    throw "$command is missing. Install it with: winget install --id $wingetId -e   then open a new terminal and run this again."
}
function Start-Docker {
    docker info --format '{{.ServerVersion}}' *> $null
    if ($LASTEXITCODE -eq 0) { return }
    Write-Host 'Starting Docker Desktop...'
    $paths = @("$env:LOCALAPPDATA\Programs\DockerDesktop\Docker Desktop.exe", "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe")
    Start-Process ($paths | Where-Object { Test-Path $_ } | Select-Object -First 1)
    for ($i = 0; $i -lt 36; $i++) {
        Start-Sleep -Seconds 5
        docker info --format '{{.ServerVersion}}' *> $null
        if ($LASTEXITCODE -eq 0) { return }
    }
    throw 'Docker Desktop did not start. Open it by hand, wait for "Engine running", and run this again.'
}
# Without a BOM, because dotenv would otherwise read it as part of the first key.
function Write-EnvFile($path, [string[]]$lines) {
    [IO.File]::WriteAllLines($path, $lines, (New-Object Text.UTF8Encoding($false)))
}

$localDb = 'postgresql://lifeos:lifeos_dev@localhost:5435/lifeos?schema=public'
$testDb = 'postgresql://lifeos:lifeos_dev@localhost:5435/lifeos_test?schema=public'

Step 'Checking tools'
Require 'node' 'OpenJS.NodeJS.LTS'
Require 'docker' 'Docker.DockerDesktop'
if ([int]((node -v) -replace '^v(\d+).*', '$1') -lt 20) { throw 'Node 20 or newer is required.' }
Start-Docker

Step 'Creating .env files (existing ones are never overwritten)'
$secret = node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
$envPath = Join-Path $PSScriptRoot '.env'
if (Test-Path $envPath) {
    Write-Host '.env already exists, keeping it.'
} else {
    Write-EnvFile $envPath @(
        '# Required',
        "DATABASE_URL=`"$localDb`"",
        "JWT_SECRET=`"$secret`"",
        '',
        'PORT=3000',
        'NODE_ENV=development',
        'CORS_ORIGINS=http://localhost:5173',
        '',
        '# AI: set at least one. Order is AICredits, then Gemini, then Groq.',
        'AICREDITS_API_KEY=',
        'GEMINI_API_KEY=',
        'GROQ_API_KEY=',
        '',
        '# Optional',
        '# PREFERRED_AI_PROVIDER=aicredits',
        '# GEMINI_MODEL=gemini-3.5-flash-lite',
        '# AICREDITS_MODELS=',
        '# AICREDITS_DAILY_CALL_LIMIT=1500',
        '# ADMIN_EMAILS=you@example.com',
        '# PUBLIC_BASE_URL=http://localhost:3000',
        '# AI_PRICES_JSON=',
        '# AI_USD_INR=88'
    )
    Write-Host 'Created .env with a local database and a new JWT_SECRET.'
}
$testEnvPath = Join-Path $PSScriptRoot '.env.test'
if (-not (Test-Path $testEnvPath)) {
    Write-EnvFile $testEnvPath @("DATABASE_URL=`"$testDb`"", "JWT_SECRET=`"$secret`"", 'NODE_ENV=test')
}

Step 'Installing npm packages'
Run 'npm' @('install')

Step 'Starting the database in Docker'
Run 'docker' @('compose', 'up', '-d', '--wait')
$exists = docker exec lifeos_postgres psql -U lifeos -d lifeos -tAc "SELECT 1 FROM pg_database WHERE datname='lifeos_test'"
if ($exists -ne '1') { Run 'docker' @('exec', 'lifeos_postgres', 'createdb', '-U', 'lifeos', 'lifeos_test') }

Step 'Preparing the databases'
Run 'npx' @('prisma', 'generate')
Run 'npx' @('prisma', 'migrate', 'deploy')
# Prisma reads .env by itself, so the test database needs the URL set explicitly.
$devUrl = $env:DATABASE_URL
$env:DATABASE_URL = $testDb
Run 'npx' @('prisma', 'migrate', 'deploy')
$env:DATABASE_URL = $devUrl

Step 'Done'
Write-Host 'Add an AI key to .env (AICREDITS_API_KEY, GEMINI_API_KEY or GROQ_API_KEY) to turn on the assistant.'
Write-Host 'Start the API:  npm run dev   (it listens on http://localhost:3000, routes are under /api/v1)'
