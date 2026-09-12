param(
  [string]$Url = "http://127.0.0.1:7603",
  [string]$ProjectId = "",
  [string]$Browser = "",
  [switch]$Creative
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$OutputEncoding = [Text.UTF8Encoding]::new($false)
. (Join-Path $PSScriptRoot "browser-smoke-profile.ps1")

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
$profile = New-BrowserSmokeProfile -Workspace $workspace
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
  return Invoke-BrowserSmokeEvaluation -Expression $Expression
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
 while(!document.querySelector('.composition-timeline')&&Date.now()<end)await new Promise(r=>setTimeout(r,100));
 const panel=[...document.querySelectorAll('.sequence-group')].find(p=>p.querySelector('strong')?.textContent==='phase4-piper-revision')?.querySelector('.sequence-panel');
 if(!panel)throw new Error('Missing phase4 panel');
 const timeline=panel.querySelector('.composition-timeline'), video=panel.querySelector('video'), slider=timeline?.querySelector('input');
 if(!timeline||!video||!slider||timeline.querySelectorAll('.timeline-bar').length<3)throw new Error('Missing timeline/media');
 while(video.readyState<1&&Date.now()<end)await new Promise(r=>setTimeout(r,100));
 slider.value='2';slider.dispatchEvent(new Event('input',{bubbles:true}));
 await new Promise(r=>setTimeout(r,300));
 if(Math.abs(video.currentTime-2)>0.2)throw new Error('Timeline seek failed');
 const imageBars=timeline.querySelector('.timeline-row').querySelectorAll('button');
 imageBars[1].click();await new Promise(r=>setTimeout(r,300));
 if(Math.abs(video.currentTime-4)>0.2)throw new Error('Segment seek failed');
 video.dataset.phase4='preserved';await new Promise(r=>setTimeout(r,3500));
 if(!document.querySelector('video[data-phase4="preserved"]'))throw new Error('Polling replaced player');
 if(timeline.querySelector('[draggable="true"]'))throw new Error('Timeline must be read-only');
 if(timeline.textContent.includes('?')||!timeline.querySelector('h5').textContent.includes('ch\u1ec9 quan s\u00e1t'))throw new Error('Timeline Vietnamese text is corrupted');
 return true;
})()
'@
 foreach($width in @(390,768,1440)) {
   Send-Cdp "Emulation.setDeviceMetricsOverride" @{width=$width;height=900;deviceScaleFactor=1;mobile=$false} | Out-Null
   if (Evaluate 'document.documentElement.scrollWidth > document.documentElement.clientWidth') {throw "Overflow at $width"}
   Evaluate "[...document.querySelectorAll('.sequence-group')].find(p=>p.querySelector('strong')?.textContent==='phase4-piper-revision')?.querySelector('.composition-timeline')?.scrollIntoView({block:'center'})" | Out-Null
   $capture = Send-Cdp "Page.captureScreenshot" @{format="png"}
   $captureDirectory = Join-Path $workspace ".cache/phase4-acceptance"
   [IO.Directory]::CreateDirectory($captureDirectory) | Out-Null
   [IO.File]::WriteAllBytes((Join-Path $captureDirectory "timeline-$width.png"), [Convert]::FromBase64String($capture.data))
 }
 [PSCustomObject]@{status="passed";timeline=$true;seek=$true;playerPreserved=$true;viewports=@(390,768,1440)} | ConvertTo-Json
} finally {
  if ($script:CdpSocket -and $script:CdpSocket.State -eq [Net.WebSockets.WebSocketState]::Open) {
    try { Send-Cdp "Browser.close" | Out-Null } catch {}
    $script:CdpSocket.Dispose()
  }
  Remove-BrowserSmokeProfile -Workspace $workspace -Profile $profile -BrowserProcess $process
}
