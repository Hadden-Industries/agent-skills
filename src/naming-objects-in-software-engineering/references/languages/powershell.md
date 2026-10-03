# PowerShell naming conventions

PowerShell language conventions adhere to Microsoft official cmdlet design guidelines, the Approved Verbs for PowerShell Commands standard, and PSScriptAnalyzer rules.

```yaml
classificationScheme:
  name: GitHub Linguist languages
  version: "v9.7.0 (commit e0c78d62c42abae6122235d8e68a7aa43eef89da)"

language:
  notation: "PowerShell"
  linguistLanguageId: 293
  preferredLabel: "PowerShell"
  color: "#012456"
  type: programming
```

## At-a-glance summary

| Artefact Kind | Convention | Example | Notes |
| --- | --- | --- | --- |
| Cmdlet / Function | `ApprovedVerb-SingularNoun` | `Get-Process`, `Test-Connection` | Microsoft Approved Verbs list |
| Parameter | `PascalCase` | `-Path`, `-TimeoutSeconds` | Standard parameter names preferred |
| Switch parameter | `PascalCase` (affirmative) | `-Recurse`, `-Force` | Never negative (`-NoCache` rejected) |
| Local variable | `lowerCamelCase` or `PascalCase` | `$itemCount`, `$targetPath` | Scriptblock / function scope |
| Script variable | `$script:PascalCase` | `$script:ConnectionPool` | Script scope |
| Environment variable | `$env:UPPER_SNAKE_CASE` | `$env:AGENT_SKILLS_HOME` | Environment provider |
| Standalone script | `kebab-case.ps1` or `PascalCase.ps1` | `backup-database.ps1` | Executable utility |
| Script module file | `PascalCase.psm1` | `StorageManagement.psm1` | Reusable module implementation |
| Module manifest | `PascalCase.psd1` | `StorageManagement.psd1` | Module metadata descriptor |

## Functions and cmdlets

- Cmdlets and exported functions MUST use the standard `Verb-Noun` format with approved verbs and singular nouns.
- Approved verbs come from Microsoft standard verb groups: `Common` (e.g. `Get`, `Set`, `New`, `Remove`, `Reset`), `Data` (e.g. `Import`, `Export`, `Convert`, `Merge`), `Lifecycle` (e.g. `Start`, `Stop`, `Restart`, `Enable`, `Disable`), `Diagnostic` (e.g. `Test`, `Debug`, `Measure`), and `Security` (e.g. `Grant`, `Revoke`, `Protect`).
- Do not use unapproved verbs such as `Check`, `Generate`, or `Parse`; use `Test`, `New`, or `ConvertFrom` instead.
- The noun part MUST be singular and `PascalCase` (e.g. `Get-Process`, `Invoke-RestMethod`, `New-StoragePool`).

## Parameters

- Parameters MUST use `PascalCase` (e.g. `-Path`, `-Credential`, `-TimeoutSeconds`, `-Force`).
- Prefer standard Microsoft parameter names when the semantic meaning matches (`-Path`, `-LiteralPath`, `-InputObject`, `-Confirm`, `-WhatIf`).
- Boolean switch parameters MUST use affirmative phrasing (e.g. `-IncludeSubdirectories`, `-Recurse`, `-Force`). Never use negative switches like `-NoCache` or `-DisableLogging`.

## Variables

- Local variables in functions and scriptblocks use `lowerCamelCase` or `PascalCase` (e.g. `$itemCount`, `$targetPath`, `$invoiceBuffer`).
- Script-scope variables use `$script:PascalCase` (e.g. `$script:ConnectionPool`).
- Environment variables accessed via the provider use `$env:UPPER_SNAKE_CASE` (e.g. `$env:AGENT_SKILLS_HOME`).

## Files and modules

- Standalone executable scripts: `kebab-case.ps1` for command-line utilities or `PascalCase.ps1` for task scripts.
- Script module code: `PascalCase.psm1` matching the module manifest.
- Module manifest: `PascalCase.psd1` matching the root module name.
- Binary cmdlet assembly: `PascalCase.dll`.
