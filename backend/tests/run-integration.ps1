$ErrorActionPreference='Stop'
Push-Location (Join-Path $PSScriptRoot '..')
$created=@()
$previousMongo=$env:MONGO_URI
$previousRedis=$env:REDIS_URL
try {
    $existingNames=@(docker ps -a --format '{{.Names}}')
    if($LASTEXITCODE){throw 'Docker engine is unavailable'}
    foreach($name in @('codeforge-resilience-test-mongo','codeforge-resilience-test-redis')) {
        if($existingNames -contains $name){throw "Test container $name already exists. Inspect it before running this script."}
    }
    docker run -d --name codeforge-resilience-test-mongo -p 127.0.0.1:17017:27017 mongo:8
    if($LASTEXITCODE){throw 'Could not start test MongoDB'}
    $created+='codeforge-resilience-test-mongo'
    docker run -d --name codeforge-resilience-test-redis -p 127.0.0.1:16379:6379 redis:7-alpine
    if($LASTEXITCODE){throw 'Could not start test Redis'}
    $created+='codeforge-resilience-test-redis'
    $env:MONGO_URI='mongodb://127.0.0.1:17017/codeforge_resilience_test'
    $env:REDIS_URL='redis://127.0.0.1:16379'
    node --test --test-force-exit tests/resilience.integration.cjs
    if($LASTEXITCODE){throw 'Integration tests failed'}
} finally {
    foreach($name in $created){docker rm -f $name | Out-Null}
    $env:MONGO_URI=$previousMongo
    $env:REDIS_URL=$previousRedis
    Pop-Location
}
