param(
  [string]$Url = "http://127.0.0.1:7603",
  [string]$ProjectId = "",
  [string]$Browser = ""
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)

if (-not $Browser) {
  $candidates = @(
    "C:\Program Files\Google\Chrome\Application\chrome.exe",
    "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
  )
  $Browser = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
}
if (-not $Browser -or -not (Test-Path -LiteralPath $Browser)) {
  throw "Không tìm thấy Chrome hoặc Edge để chạy browser smoke test."
}

if ($ProjectId) {
  $Url = $Url.TrimEnd("/") + "/?project=" + [Uri]::EscapeDataString($ProjectId)
}

$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$listener.Start()
$port = ([Net.IPEndPoint]$listener.LocalEndpoint).Port
$listener.Stop()

$workspace = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$profile = Join-Path $workspace (".browser-test-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $profile | Out-Null
$process = $null
$script:CdpSocket = $null
$script:CdpId = 0

function Send-Cdp {
  param([string]$Method, [hashtable]$Params = @{})
  $script:CdpId += 1
  $requestId = $script:CdpId
  $json = ConvertTo-Json @{ id = $requestId; method = $Method; params = $Params } -Compress -Depth 20
  $bytes = [Text.Encoding]::UTF8.GetBytes($json)
  $segment = [ArraySegment[byte]]::new($bytes)
  $script:CdpSocket.SendAsync(
    $segment,
    [Net.WebSockets.WebSocketMessageType]::Text,
    $true,
    [Threading.CancellationToken]::None
  ).GetAwaiter().GetResult() | Out-Null

  while ($true) {
    $memory = [IO.MemoryStream]::new()
    do {
      $buffer = New-Object byte[] 65536
      $part = [ArraySegment[byte]]::new($buffer)
      $received = $script:CdpSocket.ReceiveAsync(
        $part,
        [Threading.CancellationToken]::None
      ).GetAwaiter().GetResult()
      if ($received.MessageType -eq [Net.WebSockets.WebSocketMessageType]::Close) {
        throw "Browser đóng CDP socket trước khi trả response."
      }
      $memory.Write($buffer, 0, $received.Count)
    } while (-not $received.EndOfMessage)
    $message = [Text.Encoding]::UTF8.GetString($memory.ToArray()) | ConvertFrom-Json
    $memory.Dispose()
    if ($message.id -eq $requestId) {
      if ($message.error) { throw ("CDP " + $Method + ": " + $message.error.message) }
      return $message.result
    }
  }
}

function Evaluate {
  param([string]$Expression)
  $result = Send-Cdp "Runtime.evaluate" @{
    expression = $Expression
    awaitPromise = $true
    returnByValue = $true
  }
  if ($result.exceptionDetails) {
    throw ("Browser JavaScript error: " + $result.exceptionDetails.text)
  }
  return $result.result.value
}

try {
  $arguments = @(
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--remote-debugging-address=127.0.0.1",
    "--remote-debugging-port=$port",
    "--user-data-dir=$profile",
    $Url
  )
  $process = Start-Process -FilePath $Browser -ArgumentList $arguments -WindowStyle Hidden -PassThru
  $endpoint = "http://127.0.0.1:$port/json"
  $targets = $null
  $deadline = [DateTime]::UtcNow.AddSeconds(15)
  while ([DateTime]::UtcNow -lt $deadline) {
    try {
      $targets = Invoke-RestMethod -Uri $endpoint -TimeoutSec 1
      if ($targets) { break }
    } catch {
      Start-Sleep -Milliseconds 100
    }
  }
  $target = $targets | Where-Object { $_.type -eq "page" } | Select-Object -First 1
  if (-not $target) { throw "Browser không mở được page target." }

  $script:CdpSocket = [Net.WebSockets.ClientWebSocket]::new()
  $script:CdpSocket.ConnectAsync(
    [Uri]$target.webSocketDebuggerUrl,
    [Threading.CancellationToken]::None
  ).GetAwaiter().GetResult() | Out-Null
  Send-Cdp "Runtime.enable" | Out-Null

  $initialJson = Evaluate @'
(async () => {
  const deadline = Date.now() + 15000;
  while (!document.querySelector(".source-workspace") && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const player = document.querySelector(".source-player");
  if (player) player.dataset.browserMarker = "preserve-me";
  return JSON.stringify({
    workspace: !!document.querySelector(".source-workspace"),
    sources: document.querySelectorAll(".source-browser-button").length,
    player: !!player,
    timeline: !!document.querySelector(".source-timeline"),
    evidence: !!document.querySelector(".source-evidence-panel")
  });
})()
'@
  $initial = $initialJson | ConvertFrom-Json
  if (-not $initial.workspace -or $initial.sources -lt 1 -or -not $initial.player -or -not $initial.timeline -or -not $initial.evidence) {
    throw ("Workspace chưa render đầy đủ: " + $initialJson)
  }

  $transcriptJson = Evaluate @'
(async () => {
  const tab = [...document.querySelectorAll(".source-tab")].find(node => node.textContent === "Transcript");
  if (!tab || tab.disabled) return JSON.stringify({ clicked: false, rows: 0 });
  tab.click();
  const deadline = Date.now() + 10000;
  while (!document.querySelector(".transcript-row") && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return JSON.stringify({
    clicked: true,
    rows: document.querySelectorAll(".transcript-row").length,
    seekEnabled: !!document.querySelector(".evidence-time:not(:disabled)")
  });
})()
'@
  $transcript = $transcriptJson | ConvertFrom-Json
  if (-not $transcript.clicked -or $transcript.rows -lt 1 -or -not $transcript.seekEnabled) {
    throw ("Transcript/seek chưa hoạt động: " + $transcriptJson)
  }

  $preserved = Evaluate @'
(async () => {
  await new Promise(resolve => setTimeout(resolve, 2600));
  return document.querySelector(".source-player")?.dataset.browserMarker === "preserve-me";
})()
'@
  if (-not $preserved) { throw "Polling đã thay player dù dữ liệu không đổi." }

  Evaluate 'document.activeElement?.blur(); true' | Out-Null
  foreach ($width in @(390, 768, 1440)) {
    Send-Cdp "Emulation.setDeviceMetricsOverride" @{
      width = $width
      height = 900
      deviceScaleFactor = 1
      mobile = $false
    } | Out-Null
    $sizesJson = Evaluate 'JSON.stringify({scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth})'
    $sizes = $sizesJson | ConvertFrom-Json
    if ($sizes.scrollWidth -gt $sizes.clientWidth) {
      $overflow = Evaluate @'
JSON.stringify([...document.querySelectorAll("*")]
  .filter(node => {
    const box = node.getBoundingClientRect();
    return box.right > document.documentElement.clientWidth + 1 || box.left < -1;
  })
  .sort((a, b) => Math.abs(a.getBoundingClientRect().right - document.documentElement.clientWidth) - Math.abs(b.getBoundingClientRect().right - document.documentElement.clientWidth))
  .slice(0, 12)
  .map(node => ({
    tag: node.tagName,
    className: String(node.className),
    left: Math.round(node.getBoundingClientRect().left),
    right: Math.round(node.getBoundingClientRect().right),
    scrollWidth: node.scrollWidth,
    clientWidth: node.clientWidth
  })))
'@
      throw "UI tràn ngang ở viewport $width px: $sizesJson; offenders: $overflow"
    }
  }

  [PSCustomObject]@{
    status = "passed"
    browser = $Browser
    url = $Url
    sources = $initial.sources
    transcriptRows = $transcript.rows
    playerPreservedAcrossPolling = [bool]$preserved
    viewports = @(390, 768, 1440)
  } | ConvertTo-Json -Depth 5
} finally {
  if ($script:CdpSocket -and $script:CdpSocket.State -eq [Net.WebSockets.WebSocketState]::Open) {
    try { Send-Cdp "Browser.close" | Out-Null } catch {}
    $script:CdpSocket.Dispose()
  }
  if ($process -and -not $process.HasExited) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path -LiteralPath $profile) {
    $resolved = (Resolve-Path -LiteralPath $profile).Path
    $rootPrefix = $workspace + [IO.Path]::DirectorySeparatorChar
    if (-not $resolved.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
      throw "Từ chối dọn profile ngoài workspace: $resolved"
    }
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}
