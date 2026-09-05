# Daily auto-refresh, invoked by Windows Task Scheduler.
#   Local .env -> fetch products -> rebuild category pages -> commit -> push.
#   The API keys stay on this PC; only the output (products.json etc.) is pushed.
#
# NOTE: keep this file ASCII-only. Korean passed as a CLI arg gets mangled by the
#   Windows codepage, so keywords live in scripts/keywords.txt (read by Node as UTF-8)
#   and the commit message is English. Logs go to scripts/refresh.log.

# Node prints UTF-8; make the console capture it as UTF-8 so the log stays clean.
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = 'Continue'   # rely on $LASTEXITCODE, not thrown stderr

$ROOT = Split-Path -Parent $PSScriptRoot
Set-Location $ROOT

$NODE = 'C:\Program Files\nodejs\node.exe'
$SITE = 'https://kkuldeal.com'
$LOG  = Join-Path $ROOT 'scripts\refresh.log'

function Log($msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Add-Content -Path $LOG -Value $line -Encoding utf8
}

Log '=== refresh start ==='

# 1. Fetch products. --rotate 14 = use 14 keywords from the pool each run and MERGE
#    with existing data. Keeps API calls under the hourly limit while the catalog
#    grows over several days. (Keywords come from scripts/keywords.txt.)
& $NODE 'scripts/fetch-products.mjs' '--rotate' '14' 2>&1 | ForEach-Object { Log $_ }
if ($LASTEXITCODE -ne 0) { Log 'fetch failed -> abort (site keeps existing data)'; exit 1 }

# 2. Rebuild category pages + sitemap.
& $NODE 'scripts/build-pages.mjs' '--base' $SITE 2>&1 | ForEach-Object { Log $_ }
if ($LASTEXITCODE -ne 0) { Log 'build-pages failed -> abort'; exit 1 }

# 3. Commit only if something changed.
git add data c info sitemap.xml 2>&1 | Out-Null
git diff --cached --quiet
if ($LASTEXITCODE -eq 0) { Log 'no changes -> skip push'; exit 0 }

git commit -m ("data: auto refresh {0}" -f (Get-Date -Format 'yyyy-MM-dd')) 2>&1 | ForEach-Object { Log $_ }
git push origin main 2>&1 | ForEach-Object { Log $_ }
if ($LASTEXITCODE -ne 0) { Log 'push failed'; exit 1 }

Log '=== refresh done (pushed) ==='
