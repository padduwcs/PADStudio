function New-BrowserSmokeProfile {
  param([Parameter(Mandatory = $true)][string]$Workspace)

  $profileRoot = Join-Path $Workspace ".cache\browser-profiles"
  New-Item -ItemType Directory -Force -Path $profileRoot | Out-Null
  $profile = Join-Path $profileRoot ([Guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Path $profile | Out-Null
  return $profile
}

function Invoke-BrowserSmokeEvaluation {
  param(
    [Parameter(Mandatory = $true)][string]$Expression,
    [int]$TimeoutSeconds = 15
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ($true) {
    try {
      $response = Send-Cdp "Runtime.evaluate" @{
        expression = $Expression
        awaitPromise = $true
        returnByValue = $true
      }
      if ($response.exceptionDetails) {
        throw ("Browser JavaScript error: " + $response.exceptionDetails.text)
      }
      return $response.result.value
    } catch {
      $contextPending =
        $_.Exception.Message -like "*Cannot find default execution context*" -or
        $_.Exception.Message -like "*Execution context was destroyed*"
      if (-not $contextPending -or [DateTime]::UtcNow -ge $deadline) { throw }
      Start-Sleep -Milliseconds 100
    }
  }
}

function Remove-BrowserSmokeProfile {
  param(
    [Parameter(Mandatory = $true)][string]$Workspace,
    [Parameter(Mandatory = $true)][string]$Profile,
    [System.Diagnostics.Process]$BrowserProcess
  )

  if ($BrowserProcess) {
    try {
      if (-not $BrowserProcess.HasExited) {
        $BrowserProcess.WaitForExit(3000) | Out-Null
      }
      if (-not $BrowserProcess.HasExited) {
        Stop-Process -Id $BrowserProcess.Id -Force -ErrorAction SilentlyContinue
        $BrowserProcess.WaitForExit(3000) | Out-Null
      }
    } catch {}
  }

  # Chrome can leave detached children alive after Browser.close. Only stop
  # processes bound to this unique smoke profile; never match a normal profile.
  $profileProcesses = @(
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -and $_.CommandLine.Contains($Profile) }
  )
  foreach ($candidate in $profileProcesses) {
    Stop-Process -Id $candidate.ProcessId -Force -ErrorAction SilentlyContinue
  }

  $profileRoot = Join-Path $Workspace ".cache\browser-profiles"
  $resolvedRoot = [IO.Path]::GetFullPath($profileRoot).TrimEnd([IO.Path]::DirectorySeparatorChar)
  $resolvedProfile = [IO.Path]::GetFullPath($Profile)
  $rootPrefix = $resolvedRoot + [IO.Path]::DirectorySeparatorChar
  if (-not $resolvedProfile.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Từ chối dọn browser profile ngoài vùng tạm: $resolvedProfile"
  }

  for ($attempt = 1; $attempt -le 20; $attempt += 1) {
    if (-not (Test-Path -LiteralPath $resolvedProfile)) { return }
    try {
      Remove-Item -LiteralPath $resolvedProfile -Recurse -Force -ErrorAction Stop
    } catch {
      if ($attempt -eq 20) { throw }
    }
    if (Test-Path -LiteralPath $resolvedProfile) {
      Start-Sleep -Milliseconds 100
    }
  }

  if (Test-Path -LiteralPath $resolvedProfile) {
    throw "Không thể dọn browser profile tạm: $resolvedProfile"
  }
}
