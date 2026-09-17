# Installs the agent pack user-level so it applies to every repo.
#   .\install.ps1                      # Copilot + Claude Code, plus ponytail and caveman
#   .\install.ps1 -Target claude       # one platform
#   .\install.ps1 -SkipPlugins
# Model tiers in agents/*.agent.md (cheap | balanced | strong) resolve per platform here.
param(
    [ValidateSet('copilot', 'claude', 'all')][string]$Target = 'all',
    [switch]$SkipPlugins
)
$models = @{
    copilot = @{ cheap = 'gpt-5.6-luna'; balanced = 'claude-sonnet-5'; strong = 'claude-opus-5' }
    claude  = @{ cheap = 'haiku';        balanced = 'sonnet';          strong = 'opus' }  # strong = 'fable' if your plan has it
}
$claudeTools = @{ agent = 'Agent'; read = 'Read'; search = 'Grep, Glob'; execute = 'Bash'; edit = 'Edit, Write'; todo = 'TodoWrite'; web = 'WebFetch, WebSearch' }

function Render([string]$text, [string]$platform) {
    $out = foreach ($line in $text -split "\r?\n") {
        if ($line -match '^model: (\w+)$') { "model: $($models[$platform][$Matches[1]])" }
        elseif ($platform -eq 'claude' -and $line -match '^tools: \[(.*)\]$') {
            $names = [regex]::Matches($Matches[1], '"([^"]+)"').ForEach({ $_.Groups[1].Value })
            if ($names -notcontains '*') { 'tools: ' + ($names.ForEach({ $claudeTools[$_] }) -join ', ') }
        }
        else { $line }
    }
    $out -join "`n"
}

$agents = Get-ChildItem (Join-Path $PSScriptRoot 'agents\*.agent.md')

if ($Target -in 'copilot', 'all') {
    $dest = Join-Path $HOME '.copilot'
    New-Item -ItemType Directory -Force (Join-Path $dest 'agents'), (Join-Path $dest 'skills') | Out-Null
    foreach ($a in $agents) { Render (Get-Content $a -Raw) 'copilot' | Set-Content (Join-Path $dest "agents\$($a.Name)") -NoNewline }
    Copy-Item (Join-Path $PSScriptRoot 'skills\*') (Join-Path $dest 'skills') -Recurse -Force
    Write-Host "Copilot: installed to $dest"
    if (-not $SkipPlugins) {
        copilot plugin marketplace add DietrichGebert/ponytail
        copilot plugin install ponytail@ponytail
        npx -y skills add JuliusBrussee/caveman -g -a github-copilot
    }
}

if ($Target -in 'claude', 'all') {
    $dest = Join-Path $HOME '.claude'
    New-Item -ItemType Directory -Force (Join-Path $dest 'agents'), (Join-Path $dest 'skills\orchestrator') | Out-Null
    foreach ($a in $agents) {
        $name = $a.Name -replace '\.agent\.md$', ''
        Render (Get-Content $a -Raw) 'claude' | Set-Content (Join-Path $dest "agents\$name.md") -NoNewline
    }
    Copy-Item (Join-Path $PSScriptRoot 'skills\*') (Join-Path $dest 'skills') -Recurse -Force
    # Orchestrator also as a skill, so /orchestrator works in the desktop app where there is no agent picker.
    $raw = Get-Content (Join-Path $PSScriptRoot 'agents\orchestrator.agent.md') -Raw
    $desc = [regex]::Match($raw, '(?m)^description: (.*)$').Groups[1].Value
    $body = ($raw -split '(?m)^---\r?\n', 3)[2]
    "---`nname: orchestrator`ndescription: $desc`n---`n`n$body" | Set-Content (Join-Path $dest 'skills\orchestrator\SKILL.md') -NoNewline
    Write-Host "Claude Code: installed to $dest"
    if (-not $SkipPlugins) {
        claude plugin marketplace add DietrichGebert/ponytail
        claude plugin install ponytail@ponytail
        claude plugin marketplace add JuliusBrussee/caveman
        claude plugin install caveman@caveman
    }
}
