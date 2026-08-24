# Signature Recovery

Read this reference only when signature preflight or verification cannot complete, the user changes verification policy, or a signing backend cannot establish the required identity.

Commit creation always uses configured signing. A cryptographic signature header, successful signature verification, and authorization of the signer identity are separate facts. Even `skipped` identity verification requires the created commit object to contain a recognized signature header; publication remains blocked if it does not.

`required` is the default policy. It requires a verified result for the exact full commit OID and, for SSH signatures, a readable configured allowed-signers trust source. When that source is known unreadable, request the narrow read capability before actual preparation. If it becomes unavailable after a commit exists, preserve the commit. Gain access and run `workflow verify` for that same transaction, or accept an explicit user change to `advisory` or `skipped` without argument.

`advisory` records verification failure or unavailable identity evidence but may permit later gates if the signed-object requirement and all other comparisons pass. `skipped` omits identity verification, not signed creation or exact-OID binding. A policy change appends a versioned verification attempt for the same commit; it never replaces history, changes the approved message, or authorizes an unsigned retry.

Backend output may prove cryptographic validity without proving the user-intended identity. GPG, SSH, and other configured backends expose different identity and trust facts. Report exactly what the helper records and state any backend-specific limit. Do not infer authorization from a familiar email, key ID, or successful exit alone.

Never recreate, amend, reset, or replace a commit because verification or trust failed. Use only:

```text
node <skill>/scripts/commitWorkflow.mjs workflow verify --transaction <opaque-transaction> --verification <required|advisory|skipped>
```
