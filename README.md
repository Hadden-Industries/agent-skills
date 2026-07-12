# Agent Skills

This repository contains a collection of Agent Skills for AI coding agents like Claude Code, Cursor, Codex, and others. Agent skills are reusable, version-controlled instruction sets that extend your AI agent's capabilities by providing specialised domain knowledge and workflows.

## Available Skills

* **defining-concepts**: Generates strictly ISO/IEC 11179-4 compliant concept definitions from a designation. It features advanced etymological analysis, worldwide vocabulary reuse checking, and strict ontological category error prevention.

## Installation

You can install these skills using the open skills CLI, which automatically detects your supported AI agents and places the files in the correct directories.

To install all skills in this repository, run:
```bash
npx skills add Hadden-Industries/agent-skills
```

To install only the Defining Concepts skill, run:
```bash
npx skills add Hadden-Industries/agent-skills --skill defining-concepts
```

## How It Works

These skills are built on the open [Agent Skills specification](https://agentskills.io/specification). They rely on a progressive disclosure model designed to protect your agent's context window. At startup, the agent only loads the skill's name and description. The full instructional body is only read into context when the agent explicitly decides the skill is relevant to your current prompt.

## Repository Structure

This repository is structured so that compatible package managers and agents automatically crawl the root `skills/` directory to discover available capabilities.

```text
Hadden-Industries/agent-skills/
├── README.md
├── LICENSE
└── skills/
    └── defining-concepts/
        └── SKILL.md
```

## Adding New Skills

To add a new skill to this repository in the future, simply create a new directory inside the `skills/` folder. The folder name must match the `name` field in the skill's `SKILL.md` frontmatter exactly, using only lowercase letters, numbers, and hyphens.
