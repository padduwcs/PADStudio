param(
  [string]$Url = "http://127.0.0.1:7603",
  [string]$ProjectId = "",
  [string]$SequenceKey = "pilot-preview",
  [string]$Browser = "",
  [switch]$Creative,
  [string]$VisualBaseline = "scripts/browser-baselines/observer-timeline.json",
  [switch]$SkipVisualBaseline,
  [switch]$TechnicalFixture,
  [switch]$UpdateVisualBaseline
)

# Keep the acceptance entry point while testing the current viewer. The old
# inspector/timeline screenshots describe a UI that has been removed. Core
# provenance, feedback binding and QA contracts remain covered by Node tests.
$ErrorActionPreference = "Stop"
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$arguments = @{
  Url = $Url
  ProjectId = $ProjectId
  SequenceKey = $SequenceKey
  ScreenshotDirectory = Join-Path $workspace ".cache/phase5a-acceptance/viewer"
}
if ($Browser) { $arguments.Browser = $Browser }
$json = & (Join-Path $PSScriptRoot "ui-browser-smoke.ps1") @arguments
$report = $json | ConvertFrom-Json
if ($report.status -ne "passed") { throw "Viewer acceptance failed." }
$report | Add-Member -NotePropertyName visualBaseline -NotePropertyValue "retired_timeline_layout"
$report | ConvertTo-Json -Depth 8
