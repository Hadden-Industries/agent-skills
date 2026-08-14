# Pandoc installation

Read this file **only when** `scripts/check_pandoc.py` exits `10` (missing) or `11` (unusable).

## Rules

1. Prefer an existing platform package manager over downloading an arbitrary binary.
2. Use one installation method only. Do not create a second Pandoc installation merely because the first shell has not refreshed its `PATH`.
3. After installation, rerun `python scripts/check_pandoc.py`. Do not continue until it returns exit `0`.
4. If installation requires credentials, elevation, or interaction the agent cannot provide, report the exact blocked command to the user. Do not bypass the requirement by reading the EPUB directly.

## Windows

Prefer WinGet:

```powershell
winget install --source winget --exact --id JohnMacFarlane.Pandoc --silent --disable-interactivity --accept-package-agreements --accept-source-agreements
```

If WinGet is unavailable but Chocolatey is already installed:

```powershell
choco install pandoc -y
```

A fresh installer may update `PATH` only for new processes. The bundled checker also probes common Pandoc install locations, so rerun it before assuming installation failed.

## macOS

With Homebrew:

```bash
brew install pandoc
```

If Homebrew is unavailable, use Pandoc's official macOS installer rather than an untrusted mirror.

## Linux

Use the distribution package manager when it provides a sufficiently current Pandoc. Common examples:

```bash
# Debian / Ubuntu
sudo apt-get update && sudo apt-get install -y pandoc

# Fedora
sudo dnf install -y pandoc

# Arch Linux
sudo pacman -S --noconfirm pandoc
```

If the distribution package is too old or unavailable, use the official Pandoc release package or an already-configured Conda Forge environment. Do not compile Pandoc from source merely to read an EPUB unless the user explicitly requests that approach.

## Verification

Always finish by running the checker with the environment's Python 3 launcher:

```text
python scripts/check_pandoc.py
```

Use `python3` instead when `python` is not the Python 3 command on that platform.

A valid result has `"status":"ok"` and confirms both `epub_input` and `markdown_output`.
