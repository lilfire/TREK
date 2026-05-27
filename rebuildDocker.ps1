# Rebuilds the TREK image from the local source and restarts the container.
#
# Note: docker-compose.yml pins `image: trek:local` and has no
# `build:` section, so `docker compose up --build` would NOT rebuild local code.
# Instead we build the image ourselves and tag it as the name Compose expects,
# then bring the stack up so it uses the freshly built image.
#
# `trek:local` is a local-only tag (this is a fork) — it deliberately does NOT
# use the upstream `mauriceboe/trek` namespace, so `docker compose pull` can
# never overwrite the local build with an upstream image.

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

$ImageName = "trek:local"
$AppVersion = "dev"

# Check if Docker is running
docker info > $null 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Docker is not running!" -ForegroundColor Red
    Write-Host "Please start Docker Desktop and try again." -ForegroundColor Yellow
    exit 1
}

Write-Host "Stopping containers..." -ForegroundColor Cyan
docker compose down

Write-Host "Building image $ImageName from local source..." -ForegroundColor Cyan
$env:DOCKER_BUILDKIT = "1"
# --no-cache-filter client-builder forces the React/Vite build to re-run every
# time, so the served bundle always reflects the current source. Without it,
# Docker can reuse a stale `npm run build` layer and ship an old frontend.
# (Remove it for faster builds if you trust the cache.)
docker build --no-cache-filter client-builder --build-arg APP_VERSION=$AppVersion -t $ImageName .
if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed. Check the errors above." -ForegroundColor Red
    exit 1
}

Write-Host "Starting containers..." -ForegroundColor Cyan
docker compose up -d

if ($LASTEXITCODE -eq 0) {
    Write-Host "Done! Containers rebuilt successfully." -ForegroundColor Green
    Write-Host "App available at http://localhost:3000" -ForegroundColor Green
} else {
    Write-Host "Startup failed. Check the errors above." -ForegroundColor Red
    exit 1
}
