# Development releases and installed package identity

The first ordered development release is `0.1.1-dev.1`. The manifest version, release tag (`committing-to-git-0.1.1-dev.1`) and archive basename share that identifier. A full Git commit SHA remains the marketplace's immutable source pin. It identifies the repository revision, not a different release version. Earlier `0.1.0-dev.g...` versions used a truncated package-input hash; their `g` suffix was not a Git revision. Existing releases and installations retain those historical versions.

The patch-base increment ensures the new version sorts after the historical hash prereleases. Future releases normally advance the numeric `dev.N` identifier. [SemVer](https://semver.org/spec/v2.0.0.html) defines numeric prerelease ordering and requires released version contents to remain immutable. A containing commit cannot appear in its own committed manifest without changing that commit's identity.

## Build and release records

`scripts/plugin-releases.json` is an append-only development-release ledger. Each entry binds a version to a full SHA-256 inventory digest of all published input bytes, including both host manifests with only their `version` fields excluded. The digest is separate from the complete generated package inventory and archive digests. The ledger itself is outside the published package, preventing a self-reference. Rebuilding unchanged inputs retains the same version and package bytes.

Every maintained skill carries a readable string `metadata.version` in its canonical `src/<skill>/SKILL.md`, using the [Agent Skills metadata field](https://agentskills.io/specification). The build copies it into the distributed skill. For committing-to-git, the plugin build also rejects disagreement between this metadata and the selected ledger release. Earlier installed copies retain their original bytes, including the absence of version metadata.

When published inputs change, the build reports their new full digest and refuses to reuse the current version. After the exact configuration change is approved, run one deliberate release operation:

```powershell
node scripts/buildPluginPackages.js --release-version 0.1.1-dev.2
npm run build
```

Replace the example with the approved next version. The first command assigns that version to the canonical committing-to-git `SKILL.md`, regenerates its skill artifacts, computes the new input digest, appends the immutable release record, and regenerates both host manifests and the packaged skill. It preserves the Markdown body and unrelated frontmatter. The ordinary repository build covers the other maintained skills and validation; neither command advances versions implicitly. No manual digest calculation or edits to generated copies are needed. Invalid, repeated or backwards versions fail before source changes. A later generator or filesystem failure may leave intermediate files; retain them, inspect the error and finish the intended release rather than changing an old binding or automatically retrying. This command is a cooperative maintainer operation, not a concurrent-writer transaction.

In a Git checkout, generation compares the ledger against `HEAD` and rejects edited or removed committed bindings; an exported source directory has no historical baseline and treats its supplied ledger as an input. This check is a local maintenance safeguard, not authenticated history or a defence against rewriting Git history. Build count, timestamps, dirty revisions and host paths never determine the version.

Run formatting/lint and the applicable verification before review; complete `npm run verify` on the final candidate. Commit the generated package, ledger and source together through the repository's authorized Git workflow. Existing `npm run package:plugin -- --output <absolute directory>` continues to produce the desktop ZIP. To prepare an exact committed release with a revision-to-artifact mapping, use:

```powershell
node scripts/preparePluginRelease.js --repository C:\Users\maksy\GitHub\agent-skills --revision <full-verified-commit-sha> --output <absolute-external-directory>
```

The command requires a clean checkout at that exact commit, matching host versions and a committed package-input digest matching the ledger. It creates the ZIP and a versioned `*-provenance.json` beside it without overwriting existing files. Both archive commands share the same member construction. The provenance record contains the readable version, proposed tag name, full source revision, complete package inventory, input digest and archive digest. Source-to-generated correspondence and full verification are separate required evidence; a provenance record does not claim those checks ran. If an output collision interrupts creation, retain and inspect the partial bundle and select a fresh output directory.

This follows [reproducible-build principles](https://reproducible-builds.org/docs/definition/) and the [SLSA distinction between source and artifact identities](https://slsa.dev/spec/v1.2/provenance). It claims no SLSA level, authenticated attestation or publication. Treat release versions and tags as immutable after publication; never retarget an old release to changed bytes. Archive creation does not publish a release, create its tag or refresh an installed plugin. Downstream full-SHA pin updates retain their own exact configuration authorization.

## Observe an installation

Supply the actual installed plugin root and an immutable target. The command reads regular package files; it does not execute the installed helper, refresh plugins, change configuration or contact a remote service:

```powershell
node scripts/inspectPluginInstallation.js --repository C:\Users\maksy\GitHub\agent-skills --plugin-root <absolute-installed-plugin-directory> --marketplace C:\Users\maksy\GitHub\software-engineering-workflow\.agents\plugins\marketplace.json
```

Alternatively use `--revision <full-commit-sha>` instead of `--marketplace`. The selected revision must already exist in the supplied local Git repository. Use `--layout desktop` for an extracted desktop ZIP; that layout additionally checks the minimal root `plugin.json`. Default `package` layout compares every member of the Git plugin directory. Unexpected files, missing files and changed bytes are differences even when both manifests still display the expected version. The bounded inspection supports regular files only; links and special files fail explicitly. Reads are observations, not an atomic whole-directory snapshot.

The JSON report distinguishes:

| Field | Meaning |
| --- | --- |
| `installed.version` | Version observed in both installed host manifests; disagreement is an error. |
| `configuredTarget.version` | Version found at the supplied full pin, rather than inferred from `main`. |
| `configuredTarget.revision` | Full configured Git revision. |
| `configuredTarget.releaseTag` | Conventional release tag name; existence/publication is not inferred. |
| `comparison.status` | `verified-byte-match` only when the complete selected layout matches the pinned package; otherwise `different`. |
| `installed.sourceRevision` | `null`: identical bytes do not prove which of several repository commits historically supplied them. |
| `installed.loadedSessionState` | `not-observed`: files on disk do not prove what an already-running host loaded. |
| Digests | Installed inventory and helper identities for precise byte comparison. |

A verified byte match exits zero; differences, invalid inputs or unavailable observations exit nonzero. A marketplace pin identifies the intended target, not the installed state. Host-provided authenticated installation provenance or a loaded-session inventory may establish more, but this command does not invent either.
