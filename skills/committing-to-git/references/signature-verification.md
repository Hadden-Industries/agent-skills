# Signature verification

Read this reference after an actual commit is created and before running the signature-verification step in `SKILL.md`.

## Separate signing, verification, and identity authorization

`git commit -S` embeds a signature in the commit object. The helper's `verified` result means `git verify-commit --raw` returned zero for the supplied commit object. A signed commit is not automatically verified, and a policy override never authorizes retrying the commit without `-S`.

For SSH, Git uses the configured allowed-signers source to associate the key with an authorized identity. For OpenPGP, the helper reports Git's signer UID and the full fingerprint from `VALIDSIG`, not the shorter key ID from `GOODSIG`; it does not independently require an ownertrust level or signer allowlist. Do not claim stronger OpenPGP identity authorization unless a separate repository policy establishes it.

## Unreadable SSH allowed-signers file

If Git recognizes the SSH signature but reports that the allowed-signers file is unreadable, classify verification as `unavailable`, not `failed` or `verified`. Inspect only the configured source and path:

```text
git config --show-origin --get gpg.ssh.allowedSignersFile
```

While policy remains `required`, request permission only to read that exact file and then rerun the bundled verifier. Do not copy the file, edit Git configuration, or invent a different trust source. If access remains unavailable, offer the user `advisory` or `skipped` once and accept the choice without repeated pressure.

## Integrity-only checks

An SSH integrity-only check without the allowed-signers trust source can establish that a payload and embedded public key are cryptographically consistent. It cannot establish that the key is authorized for an identity, so it cannot satisfy the `required` policy and must never be reported as "verified for <identity>".

The bundled workflow deliberately records integrity-only verification as `not-run`; do not improvise signature extraction or `ssh-keygen -Y check-novalidate`. Use the user's selected verification policy and state precisely that signer trust was not established.

## Result handling

- `verified` means `git verify-commit --raw` returned zero for the exact commit object, with the backend-specific identity limits above.
- `unavailable` is reserved for the recognized unreadable SSH allowed-signers case; it does not mean the embedded signature was invalid.
- `failed` means Git returned an unsuccessful verification result for another reason. Command-launch, input, or artifact failures exit `2` instead.
- `skipped` means no verifier ran and no verification claim is permitted.

Verification failure, unavailability, or override leaves the created commit intact. Required policy blocks workflow publication until a backend-appropriate `verified` result or an explicit user policy change. Advisory and skipped policies do not by themselves block an otherwise authorized push.
