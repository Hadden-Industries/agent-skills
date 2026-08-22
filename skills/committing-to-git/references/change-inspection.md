# Change Inspection

Read this reference whenever the prepared inventory reports summarized whole-file deletions, binary changes, or submodules. It distinguishes mandatory snapshot coverage from historical-content review that is necessary only when meaning or risk depends on unseen content.

## Mandatory coverage

Every normalized change unit remains mandatory. Read and acknowledge every inventory page, required patch chunk, and metadata artifact in the primary ledger.

For a whole-file deletion, the inventory records the change-unit ID, deletion status, path, line statistics when available, exact old object ID, and old mode. Those facts establish that the approved tree removes that object. The required patch deliberately omits its repeated `-` lines because they reproduce an old blob rather than describe content being introduced into the approved tree.

A path that remains in the approved tree is not a summarized whole-file deletion. In particular, a modified text file whose new content is empty remains in the required patch. Renames, type changes, binary changes, and submodule changes keep their ordinary inventory and metadata treatment.

## Decide whether historical content is needed

Do not expand deletions mechanically, by file count, or merely because the inventory shows many removed lines. The user has already selected the commit scope; deletion summarization never proposes reducing or splitting that scope.

Expand a specific deletion when at least one of these conditions applies:

- the request and the retained-file changes do not establish why that file is being removed;
- the proposed rationale depends on what the deleted file implemented, exposed, protected, generated, or tested;
- its name suggests a public interface, compatibility layer, migration, security control, data definition, or other consequential role that cannot safely be inferred from the name alone;
- surrounding changes appear inconsistent with removal or leave a plausible dangling reference; or
- the user asks for content-level review or audit of the deletion.

Do not invent a deletion rationale from its filename. If exact historical content and surrounding evidence still do not establish the reason, ask the user rather than claiming one.

## Expand one exact historical blob

Run:

```text
node <skill>/scripts/commitWorkflow.mjs inspection expand-deletion --manifest <attempt>/snapshot.json --ledger <attempt>/inspection/ledger.json --change-unit <F000001>
```

The helper accepts only a summarized whole-file text deletion. It reads the exact full old blob ID recorded in the manifest with replacement objects and lazy fetching disabled; it does not resolve mutable `HEAD:<path>` content or silently fetch a missing promisor object. It creates `inspection/deletions/<change-unit>/`, appends bounded `deleted-content` units to the same primary ledger, and records the expanded blob's byte count and SHA-256.

Expansion makes the ledger incomplete, even if it was complete beforehand. Read every appended unit in order and acknowledge its recorded hash with the standard `inspection acknowledge` command. Rendering remains blocked until every ledger unit is reviewed.

Never use deletion expansion for a retained path, modified-to-empty file, edited rename, binary object, or gitlink. The helper rejects those cases. Inspect binary content or submodule history separately only when the rationale depends on it, and state the resulting evidence boundary accurately.

Apply the transaction-artifact collision and recovery rules loaded before snapshot creation. Never hand-edit the ledger or reconstruct deleted content from an unrecorded path lookup.
