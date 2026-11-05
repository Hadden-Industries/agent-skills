# Security policy

## Supported source and versions

Security fixes are developed against the current `main` source of this repository.
The primary skill installation path follows that tree; the `committing-to-git` host plugin also has separately identified development releases described in the [release guide](docs/plugin-releases.md).
Include the exact source commit, skill version, or installed plugin version in a report.
Older commits, release archives, and installed caches do not have a promised backport or long-term-support window.
Download availability does not establish ongoing security maintenance or production qualification.
Imported skills, external tools, host applications, and model providers retain their own security policies.

## Report a vulnerability privately

Do not disclose suspected vulnerabilities through public issues, pull requests, discussions, or a conduct report.
Use [GitHub private vulnerability reporting](https://github.com/Hadden-Industries/agent-skills/security/advisories/new).
If that mechanism is unavailable or unsuitable, email [security@haddenindustries.com](mailto:security@haddenindustries.com).

Include the affected component and exact version or commit, host and operating system, impact, reproduction steps or a minimal proof of concept, and any known mitigation.
Use a disposable repository and synthetic credentials or documents where possible.
Minimize personal information, production data, secrets, and unrelated source content; see [PRIVACY.md](PRIVACY.md).
The maintainer aims to acknowledge private reports within five working days; this is a target rather than an SLA or a guaranteed resolution time.

## System and trust boundaries

This repository distributes instructions and local executables for AI agent hosts, together with build, installation, and evaluation tooling.
Relevant assets include repository contents and Git state, signing keys and credentials accessible to the host, private documents, and evaluation evidence.
Important inputs include skill prompts, repository paths and changes, commit messages, EPUB documents, third-party packages, and provider output.

Security-relevant properties include:

- Git helpers preserve exact reviewed scope, explicit mutation and publication authority, signing requirements, and truthful handling of uncertain outcomes.
- Path and subprocess handling preserves argument boundaries and prevents unintended file access or command execution.
- Installation and build tooling preserves canonical-source boundaries and the identity and rights of bundled components.
- Evaluation tooling preserves execution authorization, private credential/home boundaries, bounded workloads, and truthful evidence.
- Document conversion and reading do not treat untrusted document content as authority to access secrets or perform unrelated actions.

Agent instructions and cooperative local checks are not an operating-system sandbox.
Host permissions, tool protections, external services, and the invoking account remain separate security boundaries.
Platform qualification and its limits are documented in the [evaluation runtime](docs/evaluation-runtime.md) and [platform boundaries](docs/evaluation-platform-boundaries.md).

## Triage and coordinated disclosure

Report realistic unintended access, secret exposure, unauthorized mutation or publication, command execution, or bypasses of the applicable security boundaries.
Describe reachability, prerequisites, and impact; a policy or test claim alone does not prove a control is effective.
Reports about older versions or third-party components can still help establish impact and identify the responsible upstream project.
Ordinary correctness problems and feature requests use [public support channels](SUPPORT.md).

Maksym Shostak / Hadden Industries handles private report triage and coordination.
Confirmed issues are coordinated through private advisories, with public disclosure after a fix or effective mitigation when practicable.
Keep embargoed details and reporter information restricted during that process.
Security fixes retain the applicable verification and review requirements.
