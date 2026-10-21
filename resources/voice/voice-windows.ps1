# Vicu's speech helper for Windows: the Windows desktop speech recognizer (System.Speech, offline,
# no account) on the default microphone, streaming what it hears as JSON lines on stdout. The
# main process starts it for one utterance (src/main/voice/windows-engine.ts) and talks to it over
# stdin. The protocol is the same as the macOS helper (native/voice-macos/VicuSpeech.swift):
#   stdout: {"type":"ready"} {"type":"partial","text":...} {"type":"final","text":...}
#           {"type":"error","code":...,"message":...} {"type":"check",...} (with -Check)
#   stdin:  "stop" (finish, send the final text) or "cancel"; end of stdin is "cancel".
param(
  [switch]$Check,
  [string]$Locale = ''
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false

function Write-Json($object) {
  $line = $object | ConvertTo-Json -Compress
  [Console]::Out.WriteLine($line)
  [Console]::Out.Flush()
}

function Fail($code, $message) {
  Write-Json @{ type = 'error'; code = $code; message = $message }
  exit 1
}

# Anything unexpected ends the helper with an error line the app can show.
trap { Fail 'failed' $_.Exception.Message }

try {
  Add-Type -AssemblyName System.Speech
  $installed = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers()
} catch {
  Fail 'unavailable' 'Windows speech recognition is not available on this system.'
}

# The installed recognizer for the requested language, else the one for the Windows display
# language, else any.
$info = $null
if ($Locale) { $info = $installed | Where-Object { $_.Culture.Name -eq $Locale } | Select-Object -First 1 }
if (-not $info) { $info = $installed | Where-Object { $_.Culture.Name -eq [System.Globalization.CultureInfo]::CurrentUICulture.Name } | Select-Object -First 1 }
if (-not $info -and $Locale) {
  $language = $Locale.Split('-')[0]
  $info = $installed | Where-Object { $_.Culture.TwoLetterISOLanguageName -eq $language } | Select-Object -First 1
}
if (-not $info) { $info = $installed | Select-Object -First 1 }

if ($Check) {
  Write-Json @{ type = 'check'; available = [bool]$info; onDevice = $true; authorization = 'authorized'; locale = $(if ($info) { $info.Culture.Name } else { '' }) }
  exit 0
}

if (-not $info) { Fail 'no-recognizer' 'No Windows speech recognizer is installed. Add one in Settings, Time & language, Speech.' }

$engine = New-Object System.Speech.Recognition.SpeechRecognitionEngine $info
try {
  $engine.SetInputToDefaultAudioDevice()
} catch {
  Fail 'audio' 'No microphone is available.'
}
$engine.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
# Pauses between words do not end the utterance; the user ends it.
$engine.EndSilenceTimeout = [TimeSpan]::FromSeconds(1.5)
$engine.BabbleTimeout = [TimeSpan]::FromSeconds(0)

$state = [hashtable]::Synchronized(@{ done = ''; current = ''; completed = $false })

function Current-Text {
  $parts = @($state.done, $state.current) | Where-Object { $_ }
  return ($parts -join ' ').Trim()
}

$null = Register-ObjectEvent -InputObject $engine -EventName SpeechHypothesized -SourceIdentifier 'vicu.hypothesis'
$null = Register-ObjectEvent -InputObject $engine -EventName SpeechRecognized -SourceIdentifier 'vicu.recognized'
$null = Register-ObjectEvent -InputObject $engine -EventName RecognizeCompleted -SourceIdentifier 'vicu.completed'

# stdin is read on a background runspace so the event loop below keeps running.
$commands = [System.Collections.Concurrent.ConcurrentQueue[string]]::new()
$reader = [PowerShell]::Create()
$null = $reader.AddScript({
  param($queue)
  while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { $queue.Enqueue('cancel'); break }
    $queue.Enqueue($line.Trim())
  }
}).AddArgument($commands)
$null = $reader.BeginInvoke()

$engine.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)
Write-Json @{ type = 'ready' }

$started = Get-Date
$stopping = $false
$stopAt = $null
while ($true) {
  foreach ($evt in @(Get-Event -ErrorAction SilentlyContinue)) {
    switch ($evt.SourceIdentifier) {
      'vicu.hypothesis' {
        $state.current = $evt.SourceEventArgs.Result.Text
        Write-Json @{ type = 'partial'; text = (Current-Text) }
      }
      'vicu.recognized' {
        $state.done = ((@($state.done, $evt.SourceEventArgs.Result.Text) | Where-Object { $_ }) -join ' ').Trim()
        $state.current = ''
        Write-Json @{ type = 'partial'; text = (Current-Text) }
      }
      'vicu.completed' {
        $state.completed = $true
      }
    }
    Remove-Event -EventIdentifier $evt.EventIdentifier
  }

  $command = $null
  while ($commands.TryDequeue([ref]$command)) {
    if ($command -eq 'cancel') {
      $engine.RecognizeAsyncCancel()
      exit 0
    }
    if ($command -eq 'stop' -and -not $stopping) {
      $stopping = $true
      $stopAt = Get-Date
      # Lets the phrase being heard finish, then raises RecognizeCompleted.
      $engine.RecognizeAsyncStop()
    }
  }

  if ($stopping -and ($state.completed -or ((Get-Date) - $stopAt).TotalSeconds -gt 2.5)) {
    Write-Json @{ type = 'final'; text = (Current-Text) }
    exit 0
  }
  Start-Sleep -Milliseconds 40
  if (-not $stopping -and ((Get-Date) - $started).TotalSeconds -gt 55) {
    $stopping = $true
    $stopAt = Get-Date
    $engine.RecognizeAsyncStop()
  }
}
