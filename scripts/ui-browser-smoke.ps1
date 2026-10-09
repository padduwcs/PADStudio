param(
  [string]$Url = "http://127.0.0.1:7603",
  [string]$ProjectId = "",
  [string]$SequenceKey = "",
  [string]$Browser = "",
  [string]$ScreenshotDirectory = "",
  [switch]$LiveFixture
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
$script:BrowserErrors = @()
$script:BrowserWrites = @()

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
    if ($message.method -eq "Runtime.exceptionThrown") { $script:BrowserErrors += $message.params.exceptionDetails }
    if ($message.method -eq "Network.requestWillBeSent" -and $message.params.request.method -notin @("GET", "HEAD")) { $script:BrowserWrites += $message.params.request }
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
  Send-Cdp "Network.enable" | Out-Null

  $readyJson = Evaluate @'
(async () => {
  const deadline = Date.now() + 20000;
  while ((!document.querySelector(".is-connected") || !document.querySelector("#checkpoint")?.textContent ||
    document.querySelector("#production-view.observer-placeholder")) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return JSON.stringify({
    title: document.querySelector("#project-title")?.textContent,
    activeView: document.querySelector('.workspace-tab[aria-selected="true"]')?.dataset.view,
    projects: document.querySelectorAll(".project-button").length,
    connected: !!document.querySelector(".is-connected"),
    video: !!document.querySelector("#view-video video"),
    empty: !!document.querySelector('#video-overview:not([hidden]) .screening-empty, .sequence-group:not([hidden]) .screening-empty'),
    panelCount: document.querySelectorAll(".view-panel:not([hidden])").length
  });
})()
'@
  $ready = $readyJson | ConvertFrom-Json
  if (-not $ready.connected -or $ready.activeView -ne "video" -or $ready.panelCount -ne 1 -or (-not $ready.video -and -not $ready.empty)) {
    throw "Studio did not become ready: $readyJson"
  }
  $brandLoaded = Evaluate @'
(async () => {
  const logo = document.querySelector('.brand image');
  if (logo?.href.baseVal !== '/brand/padstudio-emblem-transparent.png') return false;
  const image = new Image(); image.src = logo.href.baseVal;
  await image.decode();
  const favicon = document.querySelector('link[rel="icon"]');
  const response = await fetch(favicon.href);
  const svg = await response.text();
  const icon = new Image(); icon.src = favicon.href;
  await icon.decode();
  const art = document.querySelector('#view-video .brand-art');
  if (art) await art.decode();
  return image.naturalWidth === 1254 && image.naturalHeight === 1254 && response.ok &&
    response.headers.get('content-type') === 'image/svg+xml' && svg.includes('data:image/png;base64,') && !svg.includes('<rect') &&
    icon.naturalWidth === 128 && icon.naturalHeight === 128 &&
    getComputedStyle(document.querySelector('.brand-mark')).backgroundColor === 'rgba(0, 0, 0, 0)' &&
    (!art || (art.naturalWidth === 1254 && art.getAttribute('src') === '/brand/padstudio-emblem-transparent.png')) &&
    document.querySelector('.brand-name')?.textContent === 'PADStudio' &&
    document.querySelector('.brand-tagline')?.textContent === 'Precise Animated Demonstration Studio' &&
    document.querySelector('.brand').getAttribute('aria-label').startsWith('PADStudio');
})()
'@
  if (-not $brandLoaded) { throw "Brand logo or favicon did not load." }
  $fontLoaded = Evaluate @'
(async () => {
  await document.fonts.ready;
  const faces = await document.fonts.load('500 15px Manrope', 'Tiếng Việt — cà phê, tư liệu');
  return faces.length > 0 && faces.every(face => face.status === 'loaded') &&
    getComputedStyle(document.body).fontFamily.startsWith('Manrope');
})()
'@
  if (-not $fontLoaded) { throw "Local Vietnamese UI font did not load." }
  if ($SequenceKey) {
    $keyJson = ConvertTo-Json $SequenceKey -Compress
    $selected = Evaluate @"
(() => {
  const key = $keyJson;
  const picker = document.querySelector('.film-switcher select');
  if (picker) { picker.value = key; picker.dispatchEvent(new Event('change', {bubbles: true})); }
  return document.querySelector('.sequence-group:not([hidden])')?.dataset.sequenceKey === key;
})()
"@
    if (-not $selected) { throw "Requested sequence is not available: $SequenceKey" }
  }
  if ($ScreenshotDirectory) {
    New-Item -ItemType Directory -Path $ScreenshotDirectory -Force | Out-Null
    $ScreenshotDirectory = [IO.Path]::GetFullPath($ScreenshotDirectory)
  }
  $liveProgress = "not-applicable"
  if ($LiveFixture) {
    $fixtureUrl = $expectedTargetUri.GetLeftPart([UriPartial]::Authority) + "/_fixture/advance"
    $initial = Evaluate @'
(async () => {
  const deadline = Date.now() + 10000;
  while (document.querySelector('#project-state').dataset.state !== 'working' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
  return document.querySelector('#project-state').textContent === 'Đang dựng video' &&
    document.querySelector('.sequence-group:not([hidden]) .screening-empty h3')?.textContent === 'Video đang thành hình';
})()
'@
    if (-not $initial) { throw "Running project did not show progress before its first preview." }
    if ($ScreenshotDirectory) {
      foreach ($width in @(390, 1440)) {
        Send-Cdp "Emulation.setDeviceMetricsOverride" @{ width = $width; height = 1000; deviceScaleFactor = 1; mobile = $false } | Out-Null
        $shot = Send-Cdp "Page.captureScreenshot" @{ format = "png"; captureBeyondViewport = $false }
        [IO.File]::WriteAllBytes((Join-Path $ScreenshotDirectory "working-$width.png"), [Convert]::FromBase64String($shot.data))
      }
    }
    Invoke-RestMethod -Uri $fixtureUrl -Method Post | Out-Null
    $first = Evaluate @'
(async () => {
  const deadline = Date.now() + 10000;
  const player = () => document.querySelector('.sequence-group:not([hidden]) video');
  while ((!player() || player().readyState < 2 || !document.querySelector('#project-state').hidden) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
  if (!player() || player().readyState < 2) return false;
  window.__firstLivePlayer = player();
  player().currentTime = .75;
  player().muted = true;
  await player().play();
  return document.querySelector('#video-version-label').textContent === 'Bản 1' && document.querySelector('#project-state').hidden;
})()
'@
    if (-not $first) { throw "First preview did not appear automatically." }
    Invoke-RestMethod -Uri $fixtureUrl -Method Post | Out-Null
    $preserved = Evaluate @'
(async () => {
  const deadline = Date.now() + 10000;
  const revision = () => document.querySelector('.sequence-controls:not([hidden]) select');
  while ((revision()?.options.length !== 2 || document.querySelector('#project-state').dataset.state !== 'working') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
  const player = document.querySelector('.sequence-group:not([hidden]) video');
  const passed = player === window.__firstLivePlayer && !player.paused && player.currentTime > .75 &&
    document.querySelector('#video-version-label').textContent === 'Bản 1';
  player?.pause();
  return passed;
})()
'@
    if (-not $preserved) { throw "An unfinished revision interrupted the available preview." }
    Invoke-RestMethod -Uri $fixtureUrl -Method Post | Out-Null
    $updated = Evaluate @'
(async () => {
  const deadline = Date.now() + 10000;
  while ((document.querySelector('#video-version-label').textContent !== 'Bản 2' || !document.querySelector('#project-state').hidden) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
  const player = document.querySelector('.sequence-group:not([hidden]) video');
  if (!player || player.getAttribute('src') === window.__firstLivePlayer.getAttribute('src') || !document.querySelector('#delivery-section').hidden) return false;
  const revision = document.querySelector('.sequence-controls:not([hidden]) select');
  revision.value = revision.options[0].value;
  revision.dispatchEvent(new Event('change', {bubbles: true}));
  return document.querySelector('#video-version-label').textContent === 'Bản 1';
})()
'@
    if (-not $updated) { throw "The completed replacement did not become the current preview." }
    Invoke-RestMethod -Uri $fixtureUrl -Method Post | Out-Null
    $manual = Evaluate @'
(async () => {
  const deadline = Date.now() + 10000;
  const revision = () => document.querySelector('.sequence-controls:not([hidden]) select');
  while (revision()?.options.length !== 3 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
  return revision()?.options.length === 3 && document.querySelector('#video-version-label').textContent === 'Bản 1' &&
    document.querySelector('.sequence-group:not([hidden]) video')?.getAttribute('src') === window.__firstLivePlayer.getAttribute('src');
})()
'@
    if (-not $manual) { throw "A new preview replaced the user's manually selected version." }
    $liveProgress = "passed"
  }
  $viewResults = @()
  foreach ($width in @(390, 768, 1440)) {
    Send-Cdp "Emulation.setDeviceMetricsOverride" @{ width = $width; height = 1000; deviceScaleFactor = 1; mobile = $false } | Out-Null
    foreach ($view in @("video", "sources", "content", "activity")) {
      $checkJson = Evaluate @"
(async () => {
  if (["activity", "content"].includes("$view")) document.querySelector('#project-menu').open = true;
  document.querySelector('[data-view="$view"]').click();
  const deadline = Date.now() + 20000;
  const panel = document.querySelector('#view-$view');
  while (panel.querySelector('.observer-placeholder') && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  document.querySelectorAll('details').forEach(detail => detail.open = false);
  window.scrollTo(0, 0);
  return JSON.stringify({
    view: document.querySelector('.view-panel:not([hidden])')?.id.slice(5),
    panels: document.querySelectorAll('.view-panel:not([hidden])').length,
    loaded: !panel.querySelector('.observer-placeholder'),
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    headerFits: (() => {
      const boxes = [...document.querySelectorAll('.brand, .workspace-tabs, .topbar-actions')].map(node => node.getBoundingClientRect());
      return boxes.every(box => box.width > 0 && box.left >= 0 && box.right <= document.documentElement.clientWidth + 1) &&
        boxes.every((box, index) => boxes.slice(index + 1).every(other => box.right <= other.left + 1 ||
          other.right <= box.left + 1 || box.bottom <= other.top + 1 || other.bottom <= box.top + 1));
    })(),
    error: !document.querySelector('#app-error').hidden
  });
})()
"@
      $check = $checkJson | ConvertFrom-Json
      if ($check.view -ne $view -or $check.panels -ne 1 -or -not $check.loaded -or $check.error) { throw "View failed at $width px: $checkJson" }
      if ($check.scrollWidth -gt $check.clientWidth) { throw "Horizontal overflow at $width px: $checkJson" }
      if (-not $check.headerFits) { throw "Brand or navigation overlaps at $width px: $checkJson" }
      $expandedJson = Evaluate @"
(async () => {
  const panel = document.querySelector('#view-$view');
  panel.querySelectorAll('details').forEach(detail => detail.open = true);
  await new Promise(resolve => requestAnimationFrame(resolve));
  return JSON.stringify({scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth,
    offenders: [...panel.querySelectorAll('*')].filter(node => node.getBoundingClientRect().right > document.documentElement.clientWidth + 1)
      .slice(0, 12).map(node => ({tag: node.tagName, class: node.className, right: node.getBoundingClientRect().right, text: node.textContent.slice(0, 80)}))});
})()
"@
      $expanded = $expandedJson | ConvertFrom-Json
      if ($expanded.scrollWidth -gt $expanded.clientWidth) { throw "Expanded details overflow at $width px, view $view : $expandedJson" }
      Evaluate "document.querySelectorAll('details').forEach(detail => detail.open = false); window.scrollTo(0, 0); true" | Out-Null
      if ($ScreenshotDirectory) {
        Evaluate @'
(async () => {
  await Promise.all(document.getAnimations().filter(animation => Number.isFinite(animation.effect?.getComputedTiming().iterations))
    .map(animation => animation.finished.catch(() => {})));
  const player = document.querySelector('#view-video:not([hidden]) .sequence-group:not([hidden]) video, #view-video:not([hidden]) #video-overview:not([hidden]) video');
  const deadline = Date.now() + 8000;
  while (player && player.readyState < 2 && !player.error && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
  return true;
})()
'@ | Out-Null
        $shot = Send-Cdp "Page.captureScreenshot" @{ format = "png"; captureBeyondViewport = $false }
        [IO.File]::WriteAllBytes((Join-Path $ScreenshotDirectory "$view-$width.png"), [Convert]::FromBase64String($shot.data))
      }
      $viewResults += [PSCustomObject]@{ width = $width; view = $view; loaded = $true; overflow = $false }
    }
  }

  $pickerResults = @()
  foreach ($width in @(390, 1440)) {
    Send-Cdp "Emulation.setDeviceMetricsOverride" @{ width = $width; height = 1000; deviceScaleFactor = 1; mobile = $false } | Out-Null
    $pickerJson = Evaluate @'
(() => {
  document.querySelector('#sidebar-toggle').click();
  const pane = document.querySelector('#project-pane');
  const open = !pane.hidden && !pane.inert && document.querySelector('#main-content').inert;
  const searchFocused = document.activeElement === document.querySelector('#project-search');
  const buttons = [...pane.querySelectorAll('button:not(:disabled), input')];
  buttons.at(-1).focus();
  document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Tab', bubbles: true}));
  const wrapForward = document.activeElement === buttons[0];
  document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Tab', shiftKey: true, bubbles: true}));
  const wrapBack = document.activeElement === buttons.at(-1);
  document.querySelector('#project-search').focus();
  document.querySelector('#project-list').scrollTop = 0;
  const bounds = pane.getBoundingClientRect();
  return JSON.stringify({open, searchFocused, wrapForward, wrapBack,
    fits: bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight});
})()
'@
    $picker = $pickerJson | ConvertFrom-Json
    foreach ($property in @("open", "searchFocused", "wrapForward", "wrapBack", "fits")) {
      if (-not $picker.$property) { throw "Project picker failed at $width px ($property): $pickerJson" }
    }
    if ($ScreenshotDirectory) {
      $shot = Send-Cdp "Page.captureScreenshot" @{ format = "png"; captureBeyondViewport = $false }
      [IO.File]::WriteAllBytes((Join-Path $ScreenshotDirectory "projects-$width.png"), [Convert]::FromBase64String($shot.data))
    }
    $closed = Evaluate @'
(() => {
  const current = document.querySelector('.project-button.is-active');
  (current ?? document.querySelector('#project-picker-close')).click();
  return document.querySelector('#project-pane').hidden && !document.querySelector('#main-content').inert &&
    document.activeElement === document.querySelector('#sidebar-toggle');
})()
'@
    if (-not $closed) { throw "Selecting current project did not close picker and restore focus." }
    $pickerResults += [PSCustomObject]@{ width = $width; keyboard = $true; fits = $true; closesOnSelection = $true }
  }

  $interactionsJson = Evaluate @'
(async () => {
  document.querySelector('#sidebar-toggle').click();
  const query = document.querySelector('#project-search');
  const count = document.querySelectorAll('.project-button').length;
  query.value = 'zzzz-no-project-matches-zzzz';
  query.dispatchEvent(new Event('input', {bubbles: true}));
  const searchEmpty = document.querySelectorAll('.project-button').length === 0;
  query.value = '';
  query.dispatchEvent(new Event('input', {bubbles: true}));
  const searchRestored = document.querySelectorAll('.project-button').length === count;
  document.querySelector('#project-picker-close').click();
  document.querySelector('[data-view="sources"]').click();
  const filter = document.querySelector('#asset-search');
  let sourceSearch = null;
  if (filter && document.querySelector('.input-button')) {
    const sourcePlayer = document.querySelector('.asset-media video, .asset-media audio, .asset-media img');
    const total = document.querySelectorAll('.input-button:not([hidden])').length;
    filter.value = 'zzzz-no-source-matches-zzzz';
    filter.dispatchEvent(new Event('input', {bubbles: true}));
    sourceSearch = document.querySelectorAll('.input-button:not([hidden])').length === 0 && !document.querySelector('.asset-filter-empty').hidden;
    filter.value = '';
    filter.dispatchEvent(new Event('input', {bubbles: true}));
    sourceSearch = sourceSearch && document.querySelectorAll('.input-button:not([hidden])').length === total && document.querySelector('.asset-media video, .asset-media audio, .asset-media img') === sourcePlayer;
  }
  document.querySelector('[data-view="video"]').click();
  const currentPlayer = () => document.querySelector('.sequence-group:not([hidden]) video') ?? document.querySelector('#video-overview:not([hidden]) video');
  const player = currentPlayer();
  let playback = null;
  if (player) {
    const mediaDeadline = Date.now() + 10000;
    while (player.readyState < 2 && !player.error && Date.now() < mediaDeadline) await new Promise(resolve => setTimeout(resolve, 100));
    player.muted = true;
    const watch = document.querySelector('#watch-button');
    if (watch && getComputedStyle(watch).display !== 'none') {
      watch.click();
      while ((player.paused || watch.textContent.trim() !== 'Tạm dừng') && Date.now() < mediaDeadline) await new Promise(resolve => setTimeout(resolve, 100));
      if (watch.textContent.trim() !== 'Tạm dừng') throw new Error('Watch button did not follow playback');
    } else await player.play();
    const start = player.currentTime;
    const playDeadline = Date.now() + 4000;
    while (player.currentTime <= start && Date.now() < playDeadline) await new Promise(resolve => setTimeout(resolve, 100));
    playback = player.currentTime > start;
    if (watch && getComputedStyle(watch).display !== 'none') {
      watch.click();
      while (watch.textContent.trim() !== 'Phát video' && Date.now() < mediaDeadline) await new Promise(resolve => setTimeout(resolve, 100));
      if (!player.paused || watch.textContent.trim() !== 'Phát video') throw new Error('Watch button did not pause playback');
    } else player.pause();
    player.currentTime = 0;
  }
  if (player) player.dataset.uiSmoke = 'preserved';
  await new Promise(resolve => setTimeout(resolve, 2600));
  const playerPreserved = !player || currentPlayer() === player;
  const tab = document.querySelector('[data-view="video"]');
  tab.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));
  const keyboard = document.querySelector('.workspace-tab[aria-selected="true"]').dataset.view === 'sources';
  document.querySelector('[data-view="video"]').click();
  document.querySelector('#theme-toggle').click();
  const dark = document.documentElement.dataset.theme === 'dark';
  const themeStored = localStorage.getItem('padstudio-theme') === 'dark';
  let comparison = null;
  let adaptiveFrame = null;
  const videoSwitcher = document.querySelector('.film-switcher select');
  let videoSelection = null;
  if (videoSwitcher) {
    const original = videoSwitcher.value;
    videoSwitcher.value = [...videoSwitcher.options].find(option => option.value !== original).value;
    videoSwitcher.dispatchEvent(new Event('change', {bubbles: true}));
    videoSelection = document.querySelectorAll('.sequence-group:not([hidden])').length === 1 &&
      document.querySelector('.sequence-group:not([hidden])').dataset.sequenceKey === videoSwitcher.value;
    videoSwitcher.value = original;
    videoSwitcher.dispatchEvent(new Event('change', {bubbles: true}));
    videoSelection = videoSelection && document.querySelector('.sequence-group:not([hidden])').dataset.sequenceKey === original;
  }
  const group = document.querySelector('.sequence-group:not([hidden])');
  const activeControls = document.querySelector('.sequence-controls:not([hidden])');
  const viewingPlayer = currentPlayer();
  if (viewingPlayer) {
    const stage = viewingPlayer.closest('.screening-stage');
    const expectedRatio = Number(stage.style.getPropertyValue('--video-ratio'));
    const bounds = stage.getBoundingClientRect();
    adaptiveFrame = Math.abs(bounds.width / bounds.height - expectedRatio) < .015 && viewingPlayer.offsetWidth >= bounds.width - 2;
  }
  const revision = activeControls?.querySelectorAll('select')[0];
  let revisionSelection = null;
  if (revision?.options.length > 1) {
    const original = revision.value;
    const originalPlayer = group.querySelector('video');
    revision.value = [...revision.options].find(option => option.value !== original).value;
    revision.dispatchEvent(new Event('change', {bubbles: true}));
    revisionSelection = group.querySelector('video') !== originalPlayer;
    revision.value = original;
    revision.dispatchEvent(new Event('change', {bubbles: true}));
    revisionSelection = revisionSelection && group.querySelector('video')?.getAttribute('src') === originalPlayer?.getAttribute('src');
  }
  const compare = activeControls?.querySelectorAll('select')[2];
  const result = activeControls?.querySelectorAll('select')[1];
  const exactSelection = !group || !result?.value || new URL(group.querySelector('video').src).pathname.includes('/' + encodeURIComponent(result.value) + '/');
  const other = compare && [...compare.options].find(option => option.value && option.value !== result.value);
  if (other) {
    document.querySelector('#video-versions').open = true;
    compare.value = other.value;
    compare.dispatchEvent(new Event('change', {bubbles: true}));
    comparison = group.querySelectorAll('.sequence-panel').length === 2 && document.documentElement.scrollWidth <= document.documentElement.clientWidth;
    compare.value = '';
    compare.dispatchEvent(new Event('change', {bubbles: true}));
    comparison = comparison && group.querySelectorAll('.sequence-panel').length === 1;
    document.querySelector('#video-versions').open = false;
  }
  let seeking = null;
  let currentChapter = null;
  const chapterGroup = document.querySelector('#video-chapters .sequence-chapters:not([hidden])') ?? group;
  const chapter = chapterGroup?.querySelectorAll('.chapter-button')[1];
  if (chapter) {
    chapter.closest('details').open = true;
    const waitForSeek = media => new Promise((resolve, reject) => {
      const timer = setTimeout(() => { media.removeEventListener('seeked', done); reject(new Error('Chapter seek timed out')); }, 10000);
      const done = () => { clearTimeout(timer); resolve(); };
      media.addEventListener('seeked', done, {once: true});
    });
    const chapterPlayer = group.querySelector('video');
    let settled = waitForSeek(chapterPlayer);
    chapter.click();
    await settled;
    seeking = Math.abs(chapterPlayer.currentTime - Number(chapter.dataset.startSeconds)) < .1;
    currentChapter = chapter.matches('.is-active[aria-current="true"]') && chapterGroup.querySelectorAll('.chapter-button[aria-current]').length === 1;
    settled = waitForSeek(chapterPlayer);
    chapterPlayer.currentTime = 0;
    await settled;
    currentChapter = currentChapter && chapterGroup.querySelector('.chapter-button').matches('.is-active[aria-current="true"]');
    chapter.closest('details').open = false;
  }
  let feedbackAnchor = null;
  const anchorButton = group?.querySelector('.anchor-button');
  if (anchorButton) {
    const anchorPlayer = group.querySelector('video');
    const anchorProject = document.querySelector('#project-id').title;
    const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
    let copied = null;
    Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText: async value => { copied = value; }}});
    try {
      anchorButton.click();
      await pause(150);
      const wholeResult = !!copied && copied.startsWith('project=' + anchorProject + ' · result=result-') && !copied.includes(' · at=') &&
        anchorButton.parentElement.querySelector('.anchor-status').textContent.startsWith('Đã sao chép');
      let atPlayhead = true;
      if (Number.isFinite(anchorPlayer.duration) && anchorPlayer.duration > 1) {
        const seeked = new Promise(resolve => anchorPlayer.addEventListener('seeked', resolve, {once: true}));
        anchorPlayer.currentTime = Math.min(anchorPlayer.duration / 2, anchorPlayer.duration - 0.2);
        await seeked;
        copied = null;
        anchorButton.click();
        await pause(150);
        atPlayhead = !!copied && / · artifact=artifact-\S+ · revision=\d+/.test(copied) && / · at=\d+\.\d{3}$/.test(copied) &&
          Math.abs(Number(copied.match(/ · at=(\d+\.\d{3})$/)[1]) - anchorPlayer.currentTime) < 0.01;
        const reset = new Promise(resolve => anchorPlayer.addEventListener('seeked', resolve, {once: true}));
        anchorPlayer.currentTime = 0;
        await reset;
      }
      feedbackAnchor = wholeResult && atPlayhead;
    } finally {
      delete navigator.clipboard;
    }
  }
  let download = null;
  const link = document.querySelector('#delivery-view a');
  if (link) {
    const id = new URL(location.href).searchParams.get('project');
    const {context} = await (await fetch('/api/projects/' + encodeURIComponent(id) + '/observer/delivery')).json();
    const bundle = [...context.delivery.bundles].sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
    const file = bundle.files.find(file => new URL(link.href).pathname.endsWith('/' + encodeURIComponent(file.id)));
    const response = await fetch(link.href, {headers: {Range: 'bytes=0-0'}});
    await response.arrayBuffer();
    download = !!file && new URL(link.href).pathname.includes('/' + encodeURIComponent(bundle.id) + '/') && response.ok && /video|audio/.test(response.headers.get('content-type'));
  }
  const focusedLayout = document.querySelectorAll('.workspace-tab').length === 2 && !document.querySelector('#view-video .film-inspector, #view-video .sequence-detail, .workspace-footer') && !document.querySelector('#video-versions').open && !document.querySelector('.chapter-menu')?.open;
  const ids = [...document.querySelectorAll('[id]')].map(node => node.id);
  const accessibility = document.documentElement.lang === 'vi' && document.querySelectorAll('main').length === 1 && document.querySelectorAll('h1').length === 1 && new Set(ids).size === ids.length &&
    [...document.querySelectorAll('[aria-labelledby], [aria-controls]')].every(node => ['aria-labelledby', 'aria-controls'].every(attribute => !node.hasAttribute(attribute) || node.getAttribute(attribute).split(/\s+/).every(id => document.getElementById(id)))) &&
    [...document.images].every(image => image.hasAttribute('alt'));
  return JSON.stringify({searchEmpty, searchRestored, sourceSearch, focusedLayout, exactSelection, accessibility, download, playerPreserved, keyboard, dark, themeStored, player: !!player, playback, videoSelection, revisionSelection, comparison, seeking, currentChapter, feedbackAnchor, sequencePlayer: !!group?.querySelector("video"), adaptiveFrame});
})()
'@
  $interactions = $interactionsJson | ConvertFrom-Json
  foreach ($property in @("searchEmpty", "searchRestored", "focusedLayout", "exactSelection", "accessibility", "playerPreserved", "keyboard", "dark", "themeStored")) {
    if (-not $interactions.$property) { throw "Interaction failed ($property): $interactionsJson" }
  }
  # A project that plays a sequence render must expose the feedback-anchor control, and it must copy a
  # correct anchor. (Featured animation previews without a sequence have no exact sequence to point at.)
  if ($interactions.sequencePlayer -and $interactions.feedbackAnchor -ne $true) {
    throw "Feedback anchor failed: $interactionsJson"
  }
  foreach ($property in @("sourceSearch", "download", "playback", "videoSelection", "revisionSelection", "comparison", "seeking", "currentChapter", "feedbackAnchor", "adaptiveFrame")) {
    if ($null -ne $interactions.$property -and -not $interactions.$property) { throw "Media interaction failed ($property): $interactionsJson" }
  }
  if ($ScreenshotDirectory) {
    Evaluate "Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))).then(() => true)" | Out-Null
    $shot = Send-Cdp "Page.captureScreenshot" @{ format = "png"; captureBeyondViewport = $false }
    [IO.File]::WriteAllBytes((Join-Path $ScreenshotDirectory "video-dark-1440.png"), [Convert]::FromBase64String($shot.data))
  }
  if ($ScreenshotDirectory -and $interactions.comparison) {
    Evaluate @'
(() => {
  document.querySelector('#theme-toggle').click();
  document.querySelector('#video-versions').open = true;
  const controls = document.querySelector('.sequence-controls:not([hidden])');
  const result = controls.querySelectorAll('select')[1];
  const compare = controls.querySelectorAll('select')[2];
  compare.value = [...compare.options].find(option => option.value && option.value !== result.value).value;
  compare.dispatchEvent(new Event('change', {bubbles: true}));
  document.activeElement?.blur();
  return true;
})()
'@ | Out-Null
    foreach ($width in @(390, 1440)) {
      Send-Cdp "Emulation.setDeviceMetricsOverride" @{ width = $width; height = 1000; deviceScaleFactor = 1; mobile = $false } | Out-Null
      $fits = Evaluate "new Promise(resolve => requestAnimationFrame(() => resolve(document.documentElement.scrollWidth <= document.documentElement.clientWidth)))"
      if (-not $fits) { throw "Comparison overflow at $width px" }
      $shot = Send-Cdp "Page.captureScreenshot" @{ format = "png"; captureBeyondViewport = $false }
      [IO.File]::WriteAllBytes((Join-Path $ScreenshotDirectory "comparison-$width.png"), [Convert]::FromBase64String($shot.data))
    }
    Evaluate @'
(() => {
  const compare = document.querySelector('.sequence-controls:not([hidden])').querySelectorAll('select')[2];
  compare.value = ''; compare.dispatchEvent(new Event('change', {bubbles: true}));
  document.querySelector('#video-versions').open = false;
  document.querySelector('#theme-toggle').click();
  return true;
})()
'@ | Out-Null
  }
  Send-Cdp "Emulation.setDeviceMetricsOverride" @{ width = 390; height = 1000; deviceScaleFactor = 1; mobile = $false } | Out-Null
  $sidebarJson = Evaluate @'
(() => {
  document.querySelector('#sidebar-toggle').click();
  const open = document.body.classList.contains('sidebar-open') && !document.querySelector('#project-pane').inert;
  document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
  const closed = !document.body.classList.contains('sidebar-open') && document.querySelector('#project-pane').inert;
  return JSON.stringify({open, closed});
})()
'@
  $sidebar = $sidebarJson | ConvertFrom-Json
  if (-not $sidebar.open -or -not $sidebar.closed) { throw "Mobile sidebar failed: $sidebarJson" }
  $projectSwitch = Evaluate @'
(async () => {
  const original = document.querySelector('.project-button.is-active')?.dataset.projectId;
  const other = [...document.querySelectorAll('.project-button')].find(button => button.dataset.projectId !== original);
  if (!other) return 'not-applicable';
  const wait = async id => {
    const deadline = Date.now() + 20000;
    while ((new URL(location.href).searchParams.get('project') !== id ||
      document.querySelector('#production-view.observer-placeholder') || !document.querySelector('#checkpoint').textContent) && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return document.querySelector('.project-button.is-active')?.dataset.projectId === id &&
      localStorage.getItem('padstudio-project') === id &&
      !document.querySelector('#production-view.observer-placeholder') && document.querySelector('#app-error').hidden;
  };
  other.click();
  if (!await wait(other.dataset.projectId)) return JSON.stringify({status: 'failed', target: other.dataset.projectId,
    error: document.querySelector('#app-error').textContent, title: document.querySelector('#project-title').textContent,
    placeholders: [...document.querySelectorAll('.observer-placeholder')].map(element => element.id)});
  [...document.querySelectorAll('.project-button')].find(button => button.dataset.projectId === original).click();
  return await wait(original) ? 'passed' : JSON.stringify({status: 'failed', target: original,
    error: document.querySelector('#app-error').textContent, title: document.querySelector('#project-title').textContent,
    placeholders: [...document.querySelectorAll('.observer-placeholder')].map(element => element.id)});
})()
'@
  if ($projectSwitch -notin @("passed", "not-applicable")) { throw "Project switching did not finish cleanly: $projectSwitch" }
  $resumeTarget = Evaluate "document.querySelector('.project-button.is-active')?.dataset.projectId ?? null"
  $projectResume = "not-applicable"
  if ($resumeTarget) {
    Send-Cdp "Page.navigate" @{ url = $expectedTargetUri.GetLeftPart([UriPartial]::Authority) + "/?view=video" } | Out-Null
    $resumed = Evaluate @'
(async () => {
  const deadline = Date.now() + 20000;
  while ((!document.querySelector('.project-button.is-active') || document.querySelector('#production-view.observer-placeholder')) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return document.querySelector('.project-button.is-active')?.dataset.projectId ?? null;
})()
'@
    if ($resumed -ne $resumeTarget) { throw "Reopening home did not restore the last project." }
    $projectResume = "passed"
  }
  Send-Cdp "Network.emulateNetworkConditions" @{ offline = $true; latency = 0; downloadThroughput = -1; uploadThroughput = -1 } | Out-Null
  $offline = Evaluate @'
(async () => {
  const deadline = Date.now() + 6000;
  while (document.querySelector('#app-error').hidden && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
  return !document.querySelector('#app-error').hidden && !!document.querySelector('.is-disconnected');
})()
'@
  Send-Cdp "Network.emulateNetworkConditions" @{ offline = $false; latency = 0; downloadThroughput = -1; uploadThroughput = -1 } | Out-Null
  $recovered = Evaluate @'
(async () => {
  document.querySelector('#retry-button').click();
  const deadline = Date.now() + 10000;
  while ((document.querySelector('#refresh-button').disabled || !document.querySelector('.is-connected')) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
  return document.querySelector('#app-error').hidden && !!document.querySelector('.is-connected');
})()
'@
  if (-not $offline -or -not $recovered) { throw "Offline error/retry did not recover." }
  if ($script:BrowserErrors.Count) { throw ("Uncaught browser error: " + ($script:BrowserErrors | ConvertTo-Json -Depth 6)) }
  if ($script:BrowserWrites.Count) { throw "Observer made a write request." }
  $report = [PSCustomObject]@{
    status = "passed"; url = $Url; ready = $ready; viewports = $viewResults; brandLoaded = $brandLoaded; fontLoaded = $fontLoaded
    interactions = $interactions; projectPicker = $pickerResults; mobileSidebar = $sidebar; liveProgress = $liveProgress
    projectSwitch = $projectSwitch; projectResume = $projectResume; offlineRetry = $recovered
    uncaughtErrors = $script:BrowserErrors.Count; writeRequests = $script:BrowserWrites.Count
    screenshots = $ScreenshotDirectory
  }
  $reportJson = $report | ConvertTo-Json -Depth 6
  if ($ScreenshotDirectory) {
    [IO.File]::WriteAllText((Join-Path $ScreenshotDirectory "browser-result.json"), $reportJson, [Text.UTF8Encoding]::new($false))
  }
  $reportJson
} finally {
  if ($script:CdpSocket -and $script:CdpSocket.State -eq [Net.WebSockets.WebSocketState]::Open) {
    try { Send-Cdp "Browser.close" | Out-Null } catch {}
    $script:CdpSocket.Dispose()
  }
  Remove-BrowserSmokeProfile -Workspace $workspace -Profile $profile -BrowserProcess $process
}

