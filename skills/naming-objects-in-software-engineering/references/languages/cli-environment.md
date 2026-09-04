# CLI and environment variable naming conventions

This reference defines naming conventions for command-line tools, arguments, and process environment variables across operating system shells.

```yaml
classificationScheme:
  name: GitHub Linguist languages
  version: "v9.7.0 (commit e0c78d62c42abae6122235d8e68a7aa43eef89da)"

relatedLanguages:
  - notation: "Shell"
    linguistLanguageId: 346
    color: "#89e051"
    type: programming
  - notation: "PowerShell"
    linguistLanguageId: 293
    color: "#012456"
    type: programming
  - notation: "Batchfile"
    linguistLanguageId: 29
    color: "#C1F12E"
    type: programming
```

## Environment variables

Environment variables use `UPPER_SNAKE_CASE`:

```text
DATABASE_URL
DEFAULT_TIMEOUT_SECONDS
LOG_LEVEL
```

Prefix variables with an application or system namespace when necessary to prevent collisions in shared execution environments (e.g. `APP_DATABASE_URL`).

## CLI commands and options

Commands, subcommands, and long options use `kebab-case`:

```text
rebuild-index
validate-ontology
--dry-run
--output-directory
--max-retries
```

A short option is an independent artefact and follows the CLI framework syntax (for example `-o` or `-v`). Do not force long-option rules onto short options.

Published CLI commands and options represent external compatibility contracts. Renaming them requires aliases, deprecation warnings, documentation updates, and shell-completion maintenance.
