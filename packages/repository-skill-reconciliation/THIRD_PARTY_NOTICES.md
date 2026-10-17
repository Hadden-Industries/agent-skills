# Repository skill reconciliation notices

The maintained implementation is distributed under this repository's MPL-2.0 license, included as `LICENSE` in the archive.
Remote skills retain their own upstream terms; acquisition does not relicense them.

The archive bundles these unmodified, pure-Python distributions:

- **ruamel.yaml 0.19.1** — MIT; retain its bundled distribution license.
- **portalocker 4.4.0** — BSD-3-Clause; retain its bundled distribution license.
- **fastjsonschema 2.22.2** — BSD-3-Clause; copyright 2018 Michal Horejsek; retain its exact bundled license, including its redistribution conditions.

Their original `.dist-info` metadata and license files accompany the code inside the archive.
`BUILD.json` records exact versions and approved wheel hashes.
The external `skills@latest` CLI and Git/npm/Node runtimes are invoked tools, rather than copied into this archive.

The filesystem, journal and policy implementations were independently authored from the accepted behavior contracts.
No WebVOWL AGPL source is incorporated.
The native lock/source conventions belong to Vercel Skills; their original format and source-content hash meaning are retained.
