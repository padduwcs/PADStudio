param(
  [string]$Url = "http://127.0.0.1:7603",
  [string]$ProjectId = "",
  [string]$Browser = "",
  [switch]$Creative
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


  $result = Evaluate @'
(async()=>{
 const end=Date.now()+15000;
 while((!document.querySelector(".result-audio")||!document.querySelector(".result-image"))&&Date.now()<end)await new Promise(r=>setTimeout(r,100));
 const a=document.querySelector(".result-audio");
 const imgs=[...document.querySelectorAll(".result-image")];
 while((a?.readyState<1||imgs.some(i=>!i.complete))&&Date.now()<end)await new Promise(r=>setTimeout(r,100));
 if(!a||a.readyState<1||!imgs.length||imgs.some(i=>!i.naturalWidth))throw new Error("Media preview failed");
 if(!document.querySelector("#result-list").textContent.includes("Giấy phép đã khai báo"))throw new Error("Missing attribution");
 a.dataset.check="keep"; await new Promise(r=>setTimeout(r,3500));
 if(document.querySelector(".result-audio")?.dataset.check!=="keep")throw new Error("Player replaced");
 return true;
})()
'@
 foreach($width in @(390,768,1440)) {
   Send-Cdp "Emulation.setDeviceMetricsOverride" @{width=$width;height=900;deviceScaleFactor=1;mobile=$false} | Out-Null
   if (Evaluate 'document.documentElement.scrollWidth > document.documentElement.clientWidth') {throw "Overflow at $width"}
 }
 [PSCustomObject]@{status="passed";audio=$true;images=$true;attribution=$true;playerPreserved=$true;viewports=@(390,768,1440)} | ConvertTo-Json
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
