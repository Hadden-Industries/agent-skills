# C# and .NET naming conventions

This reference governs physical designations for C# codebases based on official Microsoft .NET guidelines.

```yaml
classificationScheme:
  name: GitHub Linguist languages
  version: "v9.7.0 (commit e0c78d62c42abae6122235d8e68a7aa43eef89da)"

language:
  notation: "C#"
  linguistLanguageId: 42
  preferredLabel: "C#"
  color: "#7355dd"
  type: programming
```

## At-a-glance summary

| Artefact Kind | Convention | Example | Notes |
| --- | --- | --- | --- |
| Namespace | `PascalCase.PascalCase` | `Billing.InvoiceProcessing` | Hierarchical domain |
| Class / Struct / Enum | `PascalCase` | `CustomerRegistry` | Instantiable types |
| Interface | `IPascalCase` | `IInvoiceReader` | `I` prefix required in .NET |
| Method / Property | `PascalCase` | `CalculateNetAmount` | Public member standard |
| Parameter / Local var | `camelCase` | `grossAmount` | Method scope |
| Private instance field | `_camelCase` | `_clock` | Leading underscore |
| Private static field | `s_camelCase` | `s_cache` | `s_` prefix |
| Constant | `PascalCase` | `DefaultTimeoutSeconds` | .NET standard (not UPPER_SNAKE) |
| Source file | `PascalCase.cs` | `CustomerRegistry.cs` | Matches primary declared type |

## Identifiers and members

```csharp
namespace Billing.InvoiceProcessing;

public interface IInvoiceReader { }
public sealed class CustomerRegistry { }

public decimal CalculateNetAmount(decimal grossAmount) { ... }
private readonly IClock _clock;
private static ICache s_cache;
public const int DefaultTimeoutSeconds = 30;
```

- Namespaces, types, methods, public properties/fields/events, constants: `PascalCase`.
- Interfaces: `I` + `PascalCase` (e.g. `IInvoiceReader`).
- Parameters and local variables: `camelCase`.
- Private/internal instance fields: `_camelCase` with a single leading underscore (e.g. `_clock`).
- Private/internal static fields: `s_camelCase` with `s_` prefix (e.g. `s_cache`).

Prefer clarity to brevity. Explicit `.editorconfig` rules in a repository represent repository governance and override default profile settings.
