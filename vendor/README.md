# Vendored package provenance

`llm-discovery-discovery-core-0.3.1.tgz` is the current `npm pack` output of the separate **llm-discovery-core** repository, package `@llm-discovery/discovery-core` version `0.3.1`. It contains that package's source, package metadata, README and original MIT `LICENSE`; it does not contain an installed application, credentials or runtime state. Older versioned archives may remain for provenance but are not selected by the current manifest.

The `file:vendor/...` dependency and committed lockfile allow a clone of this repository to install without a sibling checkout or a public npm release of core. Third-party packages are still resolved using the lockfile. `bundleDependencies` includes core and its required dependency tree in the advertiser's distributable package.

When updating core:

1. Test and version the change in the independent core repository, then run `npm pack` there.
2. Copy the newly versioned archive into this directory. Do not silently replace an archive with changed code under the same version.
3. Update the advertiser dependency to the new archive and regenerate `package-lock.json` with npm.
4. Run `npm ci --ignore-scripts`, `npm test` and `npm pack --dry-run`; check that the packed dependencies retain their original license files.
5. Update provenance/version records and third-party notices when their contents or versions change, then commit the archive, manifests and documentation together.

Upstream source: [nobrowning/llm-discovery-core](https://github.com/nobrowning/llm-discovery-core). The current `0.3.1` archive comes from core commit `0d9772e`, adding shared IPv4 interface listing and local-address validation. It was built from a clean LF checkout. Its SHA-256 is `826340d0629cd8e45319198a44ef1c4a81e1b8bf3742b5920cbb9e4b1438161c`. The lockfile pins the exact bytes. Published versions must not be silently replaced.
