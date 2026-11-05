# Privacy and sensitive information

## Using the skills and tooling

These skills run in the agent host and environment you choose.
Depending on the task and permissions, that environment can process prompts, repository paths and diffs, commit metadata, documents, logs, and evaluation inputs or outputs.
Agent hosts, model providers, GitHub, package registries, and external tools apply their own terms and data-handling policies.
Installing a skill does not establish offline operation, an isolated execution environment, or a particular provider retention policy.

Development setup can download tools and configure local host integrations.
Model-backed evaluations can send task content to the selected provider and require explicit execution authorization.
The [evaluation runtime](docs/evaluation-runtime.md) and [platform boundaries](docs/evaluation-platform-boundaries.md) describe local evidence and credential handling, including their limitations.
Review these effects and your host's permissions before using private repositories, signing credentials, copyrighted documents, or personal data.

## Communicating with maintainers

Public issues, pull requests, comments, and committed fixtures are public project records.
Submit only information you are entitled to share publicly.
Redact credentials, access tokens, signing material, private repository content, personal information, and unrelated document text.
Prefer minimal examples and synthetic data.

Use [private vulnerability reporting](SECURITY.md) for security-sensitive reports and the [Code of Conduct process](CODE_OF_CONDUCT.md) for conduct reports.
Private channels reduce public exposure but do not promise absolute confidentiality.
Maintainers use submitted information to investigate, respond, coordinate fixes or moderation, and retain relevant project records.
Limit access to sensitive report content to people who need it for that purpose; avoid reproducing it in public evidence.
GitHub and email providers also process information submitted through their services.

## Privacy questions and corrections

For a privacy question or a request concerning personal information sent to Hadden Industries through this project, email [privacy@haddenindustries.com](mailto:privacy@haddenindustries.com).
Identify the relevant report or public URL and the requested correction or removal without resending sensitive content unnecessarily.
Maintainers may need enough information to establish the requester's relationship to the information.
Public Git history, forks, downloads, third-party services, and copies held by other people can limit what the project can remove.
Requests concerning a host, model provider, GitHub account, or another external service must also be directed to that service as appropriate.
