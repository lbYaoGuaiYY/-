[CmdletBinding()]
param(
    [ValidateRange(1, 30)]
    [int]$Days = 2,

    [ValidateRange(1, 100)]
    [int]$Limit = 30
)

$ErrorActionPreference = 'Stop'

$sessionsRoot = Join-Path $HOME '.codex\sessions'
$projectAgentsRoot = Join-Path $PSScriptRoot 'agents'
$cutoff = (Get-Date).AddDays(-$Days)

if (-not (Test-Path -LiteralPath $sessionsRoot)) {
    throw "Codex sessions directory not found: $sessionsRoot"
}

function Get-TomlSetting {
    param(
        [Parameter(Mandatory)]
        [string]$Path,

        [Parameter(Mandatory)]
        [string]$Key
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return $null
    }

    $content = [System.IO.File]::ReadAllText($Path)
    $pattern = '(?m)^\s*' + [regex]::Escape($Key) + '\s*=\s*"([^"]+)"\s*$'
    $match = [regex]::Match($content, $pattern)
    if ($match.Success) {
        return $match.Groups[1].Value
    }

    return $null
}

$rows = foreach ($file in Get-ChildItem -LiteralPath $sessionsRoot -Recurse -File -Filter '*.jsonl' |
    Where-Object LastWriteTime -ge $cutoff |
    Sort-Object LastWriteTime -Descending) {

    $session = $null
    $model = $null
    $effort = $null

    $stream = $null
    $reader = $null
    try {
        $stream = New-Object System.IO.FileStream(
            $file.FullName,
            [System.IO.FileMode]::Open,
            [System.IO.FileAccess]::Read,
            [System.IO.FileShare]::ReadWrite
        )
        $reader = New-Object System.IO.StreamReader($stream)

        while (($line = $reader.ReadLine()) -ne $null) {
            try {
                $record = $line | ConvertFrom-Json
            }
            catch {
                continue
            }

            if (-not $session -and $record.type -eq 'session_meta') {
                $spawn = $record.payload.source.subagent.thread_spawn
                if ($spawn) {
                    $session = [pscustomobject]@{
                        Timestamp = [datetime]$record.payload.timestamp
                        ThreadId = [string]$record.payload.id
                        ParentThreadId = [string]$spawn.parent_thread_id
                        AgentPath = [string]$spawn.agent_path
                        AgentRole = [string]$spawn.agent_role
                        Nickname = [string]$spawn.agent_nickname
                    }
                }
            }
            elseif ($session -and $record.type -eq 'turn_context' -and -not $model) {
                $model = [string]$record.payload.model
                if ($record.payload.effort) {
                    $effort = [string]$record.payload.effort
                }
                else {
                    $effort = [string]$record.payload.model_reasoning_effort
                }
            }

            if ($session -and $model) {
                break
            }
        }
    }
    finally {
        if ($reader) {
            $reader.Dispose()
        }
        elseif ($stream) {
            $stream.Dispose()
        }
    }

    if (-not $session -or -not $model) {
        continue
    }

    $agentName = $session.AgentRole
    $dispatch = 'role'
    if (-not $agentName) {
        $agentName = Split-Path -Leaf $session.AgentPath
        $dispatch = 'path-only'
    }

    $agentConfig = if ($agentName) {
        Join-Path $projectAgentsRoot ($agentName + '.toml')
    }
    else {
        $null
    }

    $expectedModel = if ($agentConfig) { Get-TomlSetting -Path $agentConfig -Key 'model' } else { $null }
    $expectedEffort = if ($agentConfig) { Get-TomlSetting -Path $agentConfig -Key 'model_reasoning_effort' } else { $null }

    $status = if (-not $expectedModel) {
        'NO_CONFIG'
    }
    elseif ($model -eq $expectedModel -and $effort -eq $expectedEffort) {
        'MATCH'
    }
    else {
        'MISMATCH'
    }

    [pscustomobject]@{
        Time = $session.Timestamp.ToLocalTime().ToString('yyyy-MM-dd HH:mm:ss')
        Agent = $agentName
        Dispatch = $dispatch
        ActualModel = $model
        ActualEffort = $effort
        ExpectedModel = $expectedModel
        ExpectedEffort = $expectedEffort
        Status = $status
        ThreadId = $session.ThreadId
    }
}

$rows |
    Sort-Object Time -Descending |
    Select-Object -First $Limit |
    Format-Table -AutoSize
