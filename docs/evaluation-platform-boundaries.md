# Native evaluation platform boundaries

Choose a root for the managed evaluation home before preparing a session.

| Host    | Where to put the evaluation home                                                                                                                 |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Windows | Use a fixed drive. The Windows helper `evaluationHomesRootFromLocalAppData` derives a root from Local AppData.                                   |
| Linux   | Supply a normalized absolute path on ext2/3/4, XFS, Btrfs, F2FS, tmpfs or ramfs. Network, FUSE, layered and unknown filesystems are unsupported. |

## How the host is checked

The evaluation-home manager supports Windows and Linux through `scripts/evaluation/evaluation-path-metadata.js`.
The shared lifecycle consumes path observations (existence, directory status, redirection, volume identity, and storage classification), rather than interpreting Windows drive attributes.
No legacy metadata adapter or compatibility path is retained.

This follows HISEW's semantic host-filesystem and native-process boundaries introduced in commits `13b4abb` and `9d44da1` of `Hadden-Industries/software-engineering-workflow`.
The JavaScript implementation uses Node's native filesystem APIs; it does not add a Python runtime dependency or copy HISEW's Python implementation.

Windows retains the streamed PowerShell metadata probe, explicit argument array, shell-free invocation, fixed-drive requirement, and confirmed probe closure.
Linux uses `lstat` and `statfs`, device identities, and non-following observations.
Filesystem identifiers come from Linux's [`include/uapi/linux/magic.h`](https://github.com/torvalds/linux/blob/master/include/uapi/linux/magic.h).

Both platforms retain ancestor validation, rejection of redirected components and volume changes, exclusive markers and leases, identity-checked credential renames, and quarantine when child shutdown is uncertain.
These are filesystem observations and lifecycle controls, not an OS sandbox or a claim of atomic protection against hostile concurrent filesystem mutation.

## Permissions and credentials

On Linux, new managed directories use owner-only mode `0700` and generated records use `0600`.
Credentials are moved through the existing same-volume rename route without reading or copying their contents.

Codex invocation already selects its file-backed credential store.
Synthetic credential rotation tests do not establish a real Linux login or model session; those remain separately authorized operations.

## What the qualification covers

The runtime fingerprint and campaign repository manifest include the new adapter so previously prepared sessions detect the implementation change.
Existing root and home ownership markers retain their unchanged schema; transient path and inventory observations now use the common volume contract directly.

The Linux workflow records the checked-out revision and runtime versions and retains build and TAP output.
A passing run qualifies those checks on that revision; it does not establish macOS support or additional agent-host behavior.
