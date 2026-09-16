# Signature Recovery

Read this reference only when signature preflight or verification cannot complete, the user changes verification policy, or a signing backend cannot establish the required identity.

Commit creation always uses configured signing. A cryptographic signature header, successful signature verification, and authorization of the signer identity are separate facts. Even `skipped` identity verification requires the created commit object to contain a recognized signature header; publication remains blocked if it does not.

`required` is the default policy. It requires a verified result for the exact full commit OID and, for SSH signatures, a readable configured allowed-signers trust source. The user may choose or override `required`, `advisory`, or `skipped` at any point; explain the consequence and accept the choice without insisting on the default.

Use the helper's structured SSH trust-source state rather than treating every failure as sandbox denial:

| State | Meaning | Next action |
| --- | --- | --- |
| `readable` | The configured regular file can be opened for reading | Continue under the selected policy |
| `not-configured` | Git supplies no allowed-signers path | Repair Git configuration, or ask whether to use `advisory` or `skipped` |
| `not-found` | The configured path or one of its parent components is absent | Correct the configured path or restore the file; do not request access to a guessed alternative |
| `permission-denied` | The exact configured path exists but this process cannot open it | Request narrow read capability for the returned exact path, or ask whether to change policy |
| `invalid-file-type` | The configured path is not a regular readable file | Repair the path or configuration; do not read a directory or follow a substitute |
| `probe-error` | The operating system returned another access failure | Report the returned safe error code, repair that condition, or ask whether to change policy |

Only `permission-denied` justifies a capability request, and only for the exact `trustSource.path` returned by the helper. Do not copy the trust file, search for another trust store, change Git configuration, or infer that a missing path is protected. If access fails after a commit exists, preserve the commit. Resolve the stated condition and run `workflow verify` for that same transaction, or apply the user's explicit policy change.

`advisory` records verification failure or unavailable identity evidence but may permit later gates if the signed-object requirement and all other comparisons pass. `skipped` omits identity verification, not signed creation or exact-OID binding. A policy change appends a versioned verification attempt for the same commit; it never replaces history, changes the approved message, or authorizes an unsigned retry.

Backend output may prove cryptographic validity without proving the user-intended identity. GPG, SSH, and other configured backends expose different identity and trust facts. Report exactly what the helper records and state any backend-specific limit. Do not infer authorization from a familiar email, key ID, or successful exit alone.

Never recreate, amend, reset, or replace a commit because verification or trust failed. Use only:

```text
node <skill>/scripts/commitWorkflow.mjs workflow verify --transaction <opaque-transaction> --verification <required|advisory|skipped>
```
