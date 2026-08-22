# Execution Permissions

Read this reference before snapshot creation when the host restricts repository metadata, and whenever Git reports `Permission denied`, `index.lock`, or concurrent-operation errors.

## Permission planning

Use host-declared permissions as evidence. Do not test a known read-only `.git` boundary by deliberately running a metadata-writing command inside it. A failed probe adds noise, can leave create-only artifacts, and still requires the same scoped approval.

The command name `git write-tree` is literal: Git's [official documentation](https://git-scm.com/docs/git-write-tree) defines it as creating tree objects from the current index. Git's [upstream cache-tree implementation](https://github.com/git/git/blob/master/cache-tree.c) also acquires an index lock when it needs to update cached tree data. Do not classify that command as read-only merely because its primary output is an object ID.

Ask for the narrowest execution capability that can run the exact already-authorized command. Permission elevation changes where that command executes; it never expands workflow authority. In particular, it does not:

- change draft intent into staging authorization;
- expand `paths` or `staged` into `full`;
- approve a rendered message or authorize commit creation;
- waive signature policy; or
- authorize publication.

If the host provides no scoped mechanism, or the user denies it, stop before mutation and report the exact capability the command requires. Do not weaken repository permissions, grant full-machine access, or invent a different workflow.

## Command capability matrix

| Operation | Repository capability | Action in a read-only `.git` sandbox |
| --- | --- | --- |
| Status, policy, and scope inspection | Read worktree, index, refs, and configuration | Run inside the sandbox |
| Attempt allocation and `scope.json` authoring | Write only the external attempt directory | Run inside the sandbox |
| Any `snapshot create` mode | May write Git objects; `staged` may lock the real index to update cache metadata, while actual `full` or `paths` may lock and replace its staged tree | Request scoped execution before the first attempt |
| `inspection prepare` | Read index and objects; write only the attempt directory | Run inside the sandbox |
| Message scaffold, render, and canonical validation | Read artifacts; write only the attempt directory | Run inside the sandbox |
| `snapshot verify` | Read index, refs, and operation markers | Run inside the sandbox |
| `git commit` | Lock index, write objects and refs, and run hooks | Request scoped execution after exact-message approval |
| Signature verification | Read the exact commit, Git configuration, verifier, and trust source | Run inside the sandbox when readable; otherwise follow the signature reference |
| Report creation | Read commit, refs, index, and worktree state; write the attempt report | Run inside the sandbox unless the host identifies a narrower read boundary |
| Publication | Use network access and update a remote ref | Keep the separate publication authorization and execution gate |

Temporary index files do not imply a read-only repository operation. `git add` can write blobs and `git write-tree` can write trees to the repository object database. Until the helper explicitly isolates both the index and object stores, every snapshot-creation mode belongs in the metadata-writing row.

Do not put the whole helper executable, `git`, or a shell under one broad reusable approval. If the host supports remembered command-prefix rules, keep them at the narrowest subcommand prefix and never include `publication push`. Remember that a prefix ending before scope arguments does not itself constrain those later arguments; conversation-level scope authorization still applies.

## Classify index-lock errors

Treat error text as evidence, not as interchangeable lock failure.

### Permission boundary

An error such as `Unable to create '.git/index.lock': Permission denied` means Git could not acquire the filesystem capability needed to create the lock. It does not establish that a lock file already exists.

- Do not delete `index.lock`.
- Do not perform a lock-existence check as a substitute for permission planning.
- Confirm whether the host declared `.git` read-only or blocked the exact path.
- If scoped execution is available, apply it only to the exact failed command.
- Apply the retry rules below before rerunning anything.

### Lock collision or concurrent operation

An error saying that `index.lock` already exists, another Git process appears to be running, or an operation is active is a concurrency condition rather than a permission boundary.

- Do not solve it by requesting broader filesystem permission.
- Do not delete the lock automatically; an existence check cannot prove that no live process owns it.
- Inspect active Git operations and known same-worktree transactions without mutating either.
- Follow the main skill's serialization rule: designate one survivor, stop the loser, and restart the loser from current state only after the survivor terminates.
- Ask before any manual stale-lock removal when no owning process can be established, because removal changes Git's concurrency protection.

## Safe retry after an unexpected permission denial

When the host did not expose the restriction in advance, classify the failed command before retrying:

1. Determine whether the command created any create-only target or helper-owned intermediate. For snapshot creation, check `snapshot.json` and the fixed `temporary-index` or `preparation-index` beside it; Git may have created the intermediate index before the reported failure. For later phases, include the inspection directory, scaffold outputs, or publication result and journal.
2. Determine whether the real index, `HEAD`, an operation marker, or a remote ref may have changed. Preserve any externally caused change.
3. If a create-only target or helper-owned intermediate now exists, preserve the attempt and restart the applicable workflow phase in a fresh UUID attempt. Never delete, overwrite, or reuse the occupied target.
4. Only if neither the output nor any helper-owned intermediate exists, and the command is proven to have left relevant Git state unchanged, rerun that exact command once with scoped execution in the same attempt.
5. If state cannot be proven unchanged, do not retry. Reclassify current repository state and start a fresh attempt when the main workflow permits it.

Never broaden `paths`, switch to `full`, restage, delete a lock, reset the index, or recreate a commit merely to recover from a permission error.
