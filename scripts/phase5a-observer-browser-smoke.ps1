param(
  [string]$Url = "http://127.0.0.1:7603",
  [string]$ProjectId = "",
  [string]$Browser = "",
  [switch]$Creative,
  [string]$VisualBaseline = "scripts/browser-baselines/observer-timeline.json",
  [switch]$UpdateVisualBaseline
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

function Get-VisualSignature {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [int]$Columns = 24,
    [int]$Rows = 16
  )

  Add-Type -AssemblyName System.Drawing
  $bitmap = [Drawing.Bitmap]::new($Path)
  try {
    $cells = @()
    for ($row = 0; $row -lt $Rows; $row += 1) {
      $top = [Math]::Floor($row * $bitmap.Height / $Rows)
      $bottom = [Math]::Max($top + 1, [Math]::Floor(($row + 1) * $bitmap.Height / $Rows))
      for ($column = 0; $column -lt $Columns; $column += 1) {
        $left = [Math]::Floor($column * $bitmap.Width / $Columns)
        $right = [Math]::Max($left + 1, [Math]::Floor(($column + 1) * $bitmap.Width / $Columns))
        [long]$red = 0; [long]$green = 0; [long]$blue = 0; [long]$count = 0
        for ($y = $top; $y -lt $bottom; $y += 2) {
          for ($x = $left; $x -lt $right; $x += 2) {
            $pixel = $bitmap.GetPixel($x, $y)
            $red += $pixel.R; $green += $pixel.G; $blue += $pixel.B; $count += 1
          }
        }
        $cells += ,@([Math]::Round($red / $count), [Math]::Round($green / $count), [Math]::Round($blue / $count))
      }
    }
    return [ordered]@{ width = $bitmap.Width; height = $bitmap.Height; columns = $Columns; rows = $Rows; cells = $cells }
  } finally { $bitmap.Dispose() }
}

function Compare-VisualSignature {
  param(
    [Parameter(Mandatory = $true)]$Expected,
    [Parameter(Mandatory = $true)]$Actual,
    [double]$CellDelta = 10,
    [double]$ChangedRatioThreshold = 0.03,
    [double]$MeanDeltaThreshold = 2.0
  )

  if ($Expected.width -ne $Actual.width -or $Expected.height -ne $Actual.height) {
    return [ordered]@{ passed = $false; reason = "size $($Actual.width)x$($Actual.height) != $($Expected.width)x$($Expected.height)" }
  }
  if ($Expected.columns -ne $Actual.columns -or $Expected.rows -ne $Actual.rows -or $Expected.cells.Count -ne $Actual.cells.Count) {
    return [ordered]@{ passed = $false; reason = "signature grid mismatch" }
  }

  [double]$total = 0; [int]$changed = 0
  for ($index = 0; $index -lt $Actual.cells.Count; $index += 1) {
    $expectedCell = $Expected.cells[$index]
    $actualCell = $Actual.cells[$index]
    $delta = ([Math]::Abs($expectedCell[0] - $actualCell[0]) + [Math]::Abs($expectedCell[1] - $actualCell[1]) + [Math]::Abs($expectedCell[2] - $actualCell[2])) / 3
    $total += $delta
    if ($delta -gt $CellDelta) { $changed += 1 }
  }
  $changedRatio = $changed / $Actual.cells.Count
  $meanDelta = $total / $Actual.cells.Count
  return [ordered]@{
    passed = $changedRatio -le $ChangedRatioThreshold -and $meanDelta -le $MeanDeltaThreshold
    changedRatio = [Math]::Round($changedRatio, 6)
    changedRatioThreshold = $ChangedRatioThreshold
    meanDelta = [Math]::Round($meanDelta, 4)
    meanDeltaThreshold = $MeanDeltaThreshold
    cellDelta = $CellDelta
  }
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
 let group;
 while(!(group=[...document.querySelectorAll('.sequence-group')].find(p=>p.querySelector('strong')?.textContent==='pilot-preview'))&&Date.now()<end)await new Promise(r=>setTimeout(r,100));
 const panel=group?.querySelector('.sequence-panel');
 if(!panel)throw new Error('Missing current pilot panel');
 const timeline=panel.querySelector('.composition-timeline'), video=panel.querySelector('video'), slider=timeline?.querySelector('input');
 if(!timeline||!video||!slider||timeline.querySelectorAll('.timeline-bar').length<3)throw new Error('Missing timeline/media');
 while(video.readyState<1&&Date.now()<end)await new Promise(r=>setTimeout(r,100));
 slider.value='2';slider.dispatchEvent(new Event('input',{bubbles:true}));
 await new Promise(r=>setTimeout(r,300));
 if(Math.abs(video.currentTime-2)>0.2)throw new Error('Timeline seek failed');
 const imageBars=timeline.querySelector('.timeline-row').querySelectorAll('button');
 imageBars[1].click();await new Promise(r=>setTimeout(r,300));
 if(Math.abs(video.currentTime-8)>0.2)throw new Error('Segment seek failed');
 video.dataset.phase5a='preserved';await new Promise(r=>setTimeout(r,3500));
 if(!document.querySelector('video[data-phase5a="preserved"]'))throw new Error('Polling replaced player');
 if(timeline.querySelector('[draggable="true"]'))throw new Error('Timeline must be read-only');
 const anchors=[...panel.querySelectorAll('[data-feedback-anchor]')].map(node=>node.dataset.feedbackAnchor);
 if(!anchors.some(value=>value.includes('project=')&&value.includes('result=')&&value.includes('artifact=')&&value.includes('revision=10')))throw new Error('Missing exact revision feedback anchor');
 if(!anchors.some(value=>value.includes('segment=')&&value.includes('time=')))throw new Error('Missing segment/time feedback anchor');
 const resultSelects=group.querySelectorAll('.sequence-controls select');
 if(resultSelects.length!==3)throw new Error('Missing exact Result selectors');
 const [revisionSelect,resultSelect,compareResultSelect]=resultSelects;
 if(!resultSelect.value||!panel.querySelector('.exact-result-id')?.textContent.includes(resultSelect.value))throw new Error('Primary exact Result is not visible');
 const comparison=[...compareResultSelect.options].find(option=>option.value&&option.value!==resultSelect.value);
 if(!comparison)throw new Error('No historical exact Result is available for comparison');
 compareResultSelect.value=comparison.value;
 compareResultSelect.dispatchEvent(new Event('change',{bubbles:true}));
 await new Promise(r=>setTimeout(r,100));
 const comparedPanels=group.querySelectorAll('.sequence-panel');
 if(comparedPanels.length!==2||![...comparedPanels].some(item=>item.querySelector('.exact-result-id')?.textContent.includes(comparison.value)))throw new Error('Exact Result comparison did not render both selected Results');
 compareResultSelect.value='';compareResultSelect.dispatchEvent(new Event('change',{bubbles:true}));
 if(group.querySelectorAll('.sequence-panel').length!==1)throw new Error('Exact Result comparison did not clear');
 if(!revisionSelect.value)throw new Error('Revision selection was lost');
 const originalRevision=revisionSelect.value;
 const alternateRevision=[...revisionSelect.options].find(option=>option.textContent.startsWith('r9'));
 if(!alternateRevision)throw new Error('No alternate rendered revision is available');
 revisionSelect.value=alternateRevision.value;
 revisionSelect.dispatchEvent(new Event('change',{bubbles:true}));
 await new Promise(r=>setTimeout(r,100));
 if(!resultSelect.value||!group.querySelector('.sequence-panel .exact-result-id')?.textContent.includes(resultSelect.value))throw new Error('Switching revision did not switch the exact Result');
 revisionSelect.value=originalRevision;
 revisionSelect.dispatchEvent(new Event('change',{bubbles:true}));
 await new Promise(r=>setTimeout(r,100));
 document.querySelector('#source-analysis-view').closest('.inputs-section').scrollIntoView({block:'center'});
 while(!document.querySelector('.source-browser-list')&&Date.now()<end)await new Promise(r=>setTimeout(r,100));
 if(!document.querySelector('.source-browser-list'))throw new Error('Source section did not render from its lazy snapshot');
 document.querySelector('#creative-direction-view').closest('.inputs-section').scrollIntoView({block:'center'});
 while(!document.querySelector('.creative-direction')&&Date.now()<end)await new Promise(r=>setTimeout(r,100));
 if(!document.querySelector('.creative-direction'))throw new Error('Creative section did not render from its lazy snapshot');
 const operationsEnd=Date.now()+5000;
 while((!document.querySelector('#health-view .health-summary')||!document.querySelector('#delivery-view .delivery-card'))&&Date.now()<operationsEnd)await new Promise(r=>setTimeout(r,100));
 const health=document.querySelector('#health-view .health-summary');
 if(!health||!health.classList.contains('health-ready'))throw new Error('Ready project health is not visible: '+(document.querySelector('#health-view')?.textContent||'<empty>'));
 const delivery=document.querySelector('#delivery-view .delivery-card');
 if(!delivery||delivery.querySelectorAll('.delivery-files a').length<6)throw new Error('Verified delivery bundle links are not visible');
 const paths=performance.getEntriesByType('resource').map(entry=>new URL(entry.name).pathname);
 const projectPath='/api/projects/'+encodeURIComponent(new URL(location.href).searchParams.get('project'));
 if(paths.includes(projectPath))throw new Error('Observer loaded the legacy full project context');
 if(paths.filter(path=>path===projectPath+'/observer/production').length!==1)throw new Error('Unchanged polling reloaded production context');
 if(paths.filter(path=>path===projectPath+'/observer/source').length!==1||paths.filter(path=>path===projectPath+'/observer/creative').length!==1)throw new Error('Lazy source/creative snapshots loaded more than once');
 const activityBefore=paths.filter(path=>path===projectPath+'/observer/activity').length;
 document.querySelector('#resource-list').closest('.inputs-section').scrollIntoView({block:'center'});
 while(performance.getEntriesByType('resource').filter(entry=>new URL(entry.name).pathname===projectPath+'/observer/activity').length===activityBefore&&Date.now()<end)await new Promise(r=>setTimeout(r,100));
 if(performance.getEntriesByType('resource').filter(entry=>new URL(entry.name).pathname===projectPath+'/observer/activity').length!==activityBefore+1)throw new Error('Activity section did not lazy-load exactly once');
 if(timeline.textContent.includes('?')||!timeline.querySelector('h5').textContent.includes('ch\u1ec9 quan s\u00e1t'))throw new Error('Timeline Vietnamese text is corrupted');
 return true;
})()
'@
 $visualSignatures = [ordered]@{}
 $visualComparisons = [ordered]@{}
 foreach($width in @(390,768,1440)) {
   Send-Cdp "Emulation.setDeviceMetricsOverride" @{width=$width;height=900;deviceScaleFactor=1;mobile=$false} | Out-Null
   if (Evaluate 'document.documentElement.scrollWidth > document.documentElement.clientWidth') {throw "Overflow at $width"}
   $viewportCheck = Evaluate @'
(()=>{
 const timeline=[...document.querySelectorAll('.sequence-group')].find(p=>p.querySelector('strong')?.textContent==='pilot-preview')?.querySelector('.composition-timeline');
 if(!timeline)throw new Error('Missing timeline for viewport acceptance');
 timeline.scrollIntoView({block:'center'});
 const clipped=[...timeline.querySelectorAll('.timeline-label')].filter(label=>label.scrollWidth>label.clientWidth+1||label.scrollHeight>label.clientHeight+1).map(label=>label.textContent);
 if(clipped.length)throw new Error('Clipped timeline labels: '+clipped.join(', '));
 const duplicateIds=[...document.querySelectorAll('[id]')].map(node=>node.id).filter((id,index,ids)=>id&&ids.indexOf(id)!==index);
 const brokenLabelledBy=[...document.querySelectorAll('[aria-labelledby]')].filter(node=>node.getAttribute('aria-labelledby').split(/\s+/).some(id=>!document.getElementById(id))).length;
 const unnamed=[...document.querySelectorAll('a[href],button:not([disabled]),input:not([type="hidden"]),select:not([disabled]),textarea,summary,[tabindex]')].filter(node=>{const labelled=node.getAttribute('aria-labelledby')?.split(/\s+/).map(id=>document.getElementById(id)?.textContent||'').join(' ').trim();return !(node.getAttribute('aria-label')||labelled||node.textContent.trim()||node.getAttribute('title'));}).length;
 const imagesWithoutAlt=[...document.images].filter(image=>!image.hasAttribute('alt')).length;
 if(document.documentElement.lang!=='vi'||document.querySelectorAll('main').length!==1||document.querySelectorAll('h1').length!==1||duplicateIds.length||brokenLabelledBy||unnamed||imagesWithoutAlt)throw new Error(JSON.stringify({lang:document.documentElement.lang,mains:document.querySelectorAll('main').length,h1:document.querySelectorAll('h1').length,duplicateIds,brokenLabelledBy,unnamed,imagesWithoutAlt}));
 timeline.querySelector('input[type="range"]').value='0';
 timeline.querySelector('output').textContent='0.00 / '+Number(timeline.querySelector('input[type="range"]').max).toFixed(2)+' s';
 const rect=timeline.getBoundingClientRect();
 return {x:rect.left+scrollX,y:rect.top+scrollY,width:rect.width,height:rect.height};
})()
'@
   $capture = Send-Cdp "Page.captureScreenshot" @{format="png";fromSurface=$true;captureBeyondViewport=$true;clip=@{x=$viewportCheck.x;y=$viewportCheck.y;width=$viewportCheck.width;height=$viewportCheck.height;scale=1}}
   $captureDirectory = Join-Path $workspace ".cache/phase5a-acceptance"
   [IO.Directory]::CreateDirectory($captureDirectory) | Out-Null
   $capturePath = Join-Path $captureDirectory "observer-timeline-$width.png"
   [IO.File]::WriteAllBytes($capturePath, [Convert]::FromBase64String($capture.data))
   $visualSignatures[[string]$width] = Get-VisualSignature -Path $capturePath
 }
 $baselinePath = [IO.Path]::GetFullPath((Join-Path $workspace $VisualBaseline))
 if ($UpdateVisualBaseline) {
   [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($baselinePath)) | Out-Null
   [IO.File]::WriteAllText($baselinePath, (($visualSignatures | ConvertTo-Json -Depth 20 -Compress) + "`n"), [Text.UTF8Encoding]::new($false))
 } else {
   if (-not (Test-Path -LiteralPath $baselinePath)) { throw "Thiếu visual baseline: $baselinePath. Chạy lại với -UpdateVisualBaseline sau khi review ảnh capture." }
   $baseline = Get-Content -Raw -Encoding UTF8 $baselinePath | ConvertFrom-Json
   foreach ($width in @(390,768,1440)) {
     $comparison = Compare-VisualSignature -Expected $baseline.([string]$width) -Actual $visualSignatures[[string]$width]
     $visualComparisons[[string]$width] = $comparison
     if (-not $comparison.passed) { throw "Visual regression at $width px: $($comparison | ConvertTo-Json -Compress)" }
   }
 }
 [PSCustomObject]@{status="passed";timeline=$true;seek=$true;playerPreserved=$true;conditionalPolling=$true;lazyActivity=$true;feedbackAnchors=$true;exactResultSelection=$true;exactResultSwitching=$true;exactResultComparison=$true;health=$true;delivery=$true;accessibilitySmoke=$true;timelineLabelsUnclipped=$true;visualRegression=if($UpdateVisualBaseline){"baseline_updated"}else{"passed"};visualComparisons=$visualComparisons;viewports=@(390,768,1440)} | ConvertTo-Json -Depth 10
} finally {
  if ($script:CdpSocket -and $script:CdpSocket.State -eq [Net.WebSockets.WebSocketState]::Open) {
    try { Send-Cdp "Browser.close" | Out-Null } catch {}
    $script:CdpSocket.Dispose()
  }
  Remove-BrowserSmokeProfile -Workspace $workspace -Profile $profile -BrowserProcess $process
}
