param(
  [string]$Url = "http://127.0.0.1:7603",
  [string]$ProjectId = "",
  [string]$Browser = "",
  [switch]$Creative,
  [switch]$StructureOnly
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
$expectedTargetUri = [Uri]$Url

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
  $target = $null
  $deadline = [DateTime]::UtcNow.AddSeconds(15)
  while ([DateTime]::UtcNow -lt $deadline) {
    try {
      $targets = Invoke-RestMethod -Uri $endpoint -TimeoutSec 1
      $target = $targets |
        Where-Object {
          if ($_.type -ne "page") { return $false }
          try {
            $candidateUri = [Uri]$_.url
            $sameDocument =
              $candidateUri.Scheme -eq $expectedTargetUri.Scheme -and
              $candidateUri.Host -eq $expectedTargetUri.Host -and
              $candidateUri.Port -eq $expectedTargetUri.Port -and
              $candidateUri.AbsolutePath.TrimEnd("/") -eq $expectedTargetUri.AbsolutePath.TrimEnd("/")
            if (-not $sameDocument) { return $false }
            if ($ProjectId) { return $candidateUri.Query -eq $expectedTargetUri.Query }
            return $true
          } catch {
            return $false
          }
        } |
        Select-Object -First 1
      if ($target) { break }
    } catch {
      Start-Sleep -Milliseconds 100
    }
  }
  if (-not $target) { throw "Browser không mở được page target." }

  $script:CdpSocket = [Net.WebSockets.ClientWebSocket]::new()
  $script:CdpSocket.ConnectAsync(
    [Uri]$target.webSocketDebuggerUrl,
    [Threading.CancellationToken]::None
  ).GetAwaiter().GetResult() | Out-Null
  Send-Cdp "Runtime.enable" | Out-Null

  $initialJson = Evaluate @'
(async () => {
  document.querySelector("#source-analysis-view")?.scrollIntoView();
  const deadline = Date.now() + 15000;
  while (!document.querySelector(".source-workspace") && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  const player = document.querySelector(".source-player");
  if (player) player.dataset.browserMarker = "preserve-me";
  return JSON.stringify({
    href: location.href,
    readyState: document.readyState,
    checkpoint: document.querySelector("#checkpoint")?.textContent,
    workspace: !!document.querySelector(".source-workspace"),
    sources: document.querySelectorAll(".source-browser-button").length,
    player: !!player,
    timeline: !!document.querySelector(".source-timeline"),
    evidence: !!document.querySelector(".source-evidence-panel"),
    animationView: !!document.querySelector("#animation-view"),
    animationHeading: !!document.querySelector("#animation-heading"),
    animationRendered: !!document.querySelector("#animation-view .empty-note, #animation-view [data-animation-artifact]")
  });
})()
'@
  $initial = $initialJson | ConvertFrom-Json
  if (
    -not $initial.workspace -or $initial.sources -lt 1 -or
    -not $initial.timeline -or -not $initial.evidence -or
    -not $initial.animationView -or -not $initial.animationHeading
  ) {
    throw ("Workspace chưa render đầy đủ: " + $initialJson)
  }

  if ($StructureOnly) {
    if (-not $initial.animationRendered) {
      throw ("Animation observer did not finish rendering: " + $initialJson)
    }
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
        throw "Observer has horizontal overflow at viewport $width px: $sizesJson"
      }
    }
    [PSCustomObject]@{
      status = "passed"
      mode = "structure-only"
      browser = $Browser
      url = $Url
      animation = "rendered"
      viewports = @(390, 768, 1440)
    } | ConvertTo-Json -Depth 5
    return
  }
  if (-not $initial.player) {
    throw ("Workspace source player is not available for the full interaction smoke test: " + $initialJson)
  }

  $creativeJson = Evaluate @'
(async () => {
  document.querySelector("#creative-direction-view")?.scrollIntoView();
  const deadline = Date.now() + 15000;
  while (!document.querySelector(".creative-workspace") && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return JSON.stringify({
    workspace: !!document.querySelector(".creative-workspace"),
    brief: !!document.querySelector(".creative-brief"),
    proposal: !!document.querySelector(".creative-proposal"),
    options: document.querySelectorAll(".creative-option").length,
    selectedOptions: document.querySelectorAll(".creative-option.is-selected").length,
    direction: !!document.querySelector(".creative-direction"),
    sample: !!document.querySelector(".creative-sample"),
    directionApproved: !!document.querySelector(".creative-direction .creative-approval.is-approved"),
    renderApproved: !!document.querySelector(".creative-sample .creative-pill.is-approved"),
    history: !!document.querySelector(".creative-history")
  });
})()
'@
  $creativeState = $creativeJson | ConvertFrom-Json
  if ($Creative -and (
    -not $creativeState.workspace -or -not $creativeState.brief -or -not $creativeState.proposal -or
    $creativeState.options -lt 2 -or $creativeState.selectedOptions -ne 1 -or
    -not $creativeState.direction -or -not $creativeState.sample -or
    -not $creativeState.directionApproved -or -not $creativeState.renderApproved -or
    -not $creativeState.history
  )) {
    throw ("Creative observer chưa render/bind đầy đủ: " + $creativeJson)
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

  $datasetJson = Evaluate @'
(async () => {
  const sourceCount = document.querySelectorAll(".source-browser-button").length;
  let multipleResultSets = false;
  let resultSetSwitch = false;
  let pagination = false;
  let rowsAfterPagination = 0;
  const selectorCounts = [];
  for (let index = 0; index < sourceCount; index += 1) {
    document.querySelectorAll(".source-browser-button")[index]?.click();
    await new Promise(resolve => setTimeout(resolve, 150));
    const tab = [...document.querySelectorAll(".source-tab")].find(node => node.textContent === "Transcript");
    if (!tab || tab.disabled) continue;
    tab.click();
    const deadline = Date.now() + 10000;
    while (!document.querySelector(".transcript-row") && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const more = document.querySelector(".source-load-more");
    if (more) {
      const before = document.querySelectorAll(".transcript-row").length;
      more.click();
      const pageDeadline = Date.now() + 10000;
      while (document.querySelectorAll(".transcript-row").length <= before && Date.now() < pageDeadline) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      rowsAfterPagination = document.querySelectorAll(".transcript-row").length;
      pagination = rowsAfterPagination > before;
    }
    const resultSelector = () => [...document.querySelectorAll(".source-result-select select")]
      .find(node => [...node.options].every(option => option.value.startsWith("result-")));
    const selector = resultSelector();
    selectorCounts.push(selector?.options.length ?? 0);
    if (selector?.options.length > 1) {
      multipleResultSets = true;
      const previous = selector.value;
      selector.selectedIndex = selector.selectedIndex === 0 ? 1 : 0;
      const changed = selector.value !== previous;
      selector.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 500));
      resultSetSwitch = changed && selector.value !== previous
        && document.querySelectorAll(".transcript-row").length > 0
        && !document.querySelector(".source-state-error");
    }
    if (multipleResultSets && resultSetSwitch && pagination) break;
  }
  return JSON.stringify({ multipleResultSets, resultSetSwitch, pagination, rowsAfterPagination, selectorCounts });
})()
'@
  $dataset = $datasetJson | ConvertFrom-Json
  if (-not $Creative -and (
    -not $dataset.multipleResultSets -or -not $dataset.resultSetSwitch -or -not $dataset.pagination
  )) {
    throw ("Fixture chưa kiểm chứng được nhiều Result set và pagination: " + $datasetJson)
  }

  $searchJson = Evaluate @'
(async () => {
  const text = document.querySelector(".transcript-text p")?.textContent ?? "";
  const term = text.split(/\s+/).map(value => value.replace(/[^\p{L}\p{N}]/gu, "")).find(value => value.length >= 3);
  const input = document.querySelector('.source-search-form input[type="search"]');
  const form = document.querySelector(".source-search-form");
  if (!term || !input || !form) return JSON.stringify({ searched: false, results: 0, term });
  input.value = term;
  form.requestSubmit();
  const deadline = Date.now() + 10000;
  while (!document.querySelector(".search-result") && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return JSON.stringify({
    searched: true,
    results: document.querySelectorAll(".search-result").length,
    term
  });
})()
'@
  $search = $searchJson | ConvertFrom-Json
  if (-not $search.searched -or $search.results -lt 1) {
    throw ("Search index/browser chưa hoạt động: " + $searchJson)
  }
  Evaluate 'const player = document.querySelector(".source-player"); if (player) player.dataset.browserMarker = "preserve-me"; !!player' | Out-Null

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
    multipleResultSets = [bool]$dataset.multipleResultSets
    resultSetSwitch = [bool]$dataset.resultSetSwitch
    paginatedTranscriptRows = $dataset.rowsAfterPagination
    searchResults = $search.results
    playerPreservedAcrossPolling = [bool]$preserved
    creative = $creativeState
    viewports = @(390, 768, 1440)
  } | ConvertTo-Json -Depth 5
} finally {
  if ($script:CdpSocket -and $script:CdpSocket.State -eq [Net.WebSockets.WebSocketState]::Open) {
    try { Send-Cdp "Browser.close" | Out-Null } catch {}
    $script:CdpSocket.Dispose()
  }
  Remove-BrowserSmokeProfile -Workspace $workspace -Profile $profile -BrowserProcess $process
}
