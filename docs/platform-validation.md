# Platform validation: advertiser 0.3.1

Component validation completed on 2026-11-03. This record covers package installation, CLI setup, configuration validation, and deterministic protocol behavior. It does **not** establish real LAN announcements, Bonjour/Avahi coexistence, or Harness desktop acceptance.

| Environment | Runtime | Source checked | Result |
|---|---|---|---|
| Physical Mac, ARM64; Darwin kernel `27.2.0` | Node.js `v24.22.2` | `3b2a9bbf2e0805c284548e4d53c5d3f102a516b8` | 20 tests passed; offline archive installation and CLI checks passed |
| Ubuntu WSL2, Linux x64; kernel `6.18.40.1-microsoft-standard-WSL2` | Node.js `v24.22.2` | Same commit | 20 tests passed; offline archive installation and CLI checks passed |
| Windows x64 development environment | Node.js `v24.21.0` | Same commit | 20 tests passed; offline archive installation and CLI checks passed |

Each Mac/Linux run completed `npm ci --ignore-scripts`, `npm test`, and `npm run release:prepare`. Final tarballs were installed in isolated projects with an empty npm cache and `--offline`; no registry dependency was required by the installed package. Checks exercised its exports and the actual installed CLI: `--help`, `--list-interfaces --json`, `--example FILE`, and `--config FILE --check`. Test transports were simulated; these commands did not start a multicast advertiser.

The Mac and Linux builds produced the same canonical archive:

```text
c09bcaec7f074aaecbb473ac49f7f2e16070cdbd7ff2b0cc1e3c3558d15663a2  llm-discovery-advertiser-0.3.1.tgz
```

The Windows build had SHA-256 `6ed15cc4506acbfdf56b43596d7de78a7e0db0c0f75a639678b011701ed2af13`. All file contents were identical; its bundled `node_modules/multicast-dns/cli.js` tar entry used mode `0644`, while Mac/Linux used `0755`. The Linux release workflow remains the canonical archive producer. Both archive variants passed installed-package checks.

The [CI run for the implementation commit](https://github.com/nobrowning/llm-api-advertiser/actions/runs/41654543062) also completed successfully across all six configured jobs: Linux x64 with Node.js 22 and 24, and Linux ARM64, Windows x64, macOS ARM64, and macOS Intel with Node.js 24. Each job checked its actual runtime architecture and ran final-archive installation checks.

Actual cross-machine discovery and mDNS coexistence results are maintained separately in the [Demo validation report](https://github.com/nobrowning/llm-service-discovery-demo/blob/main/docs/validation-report.md). A valid configuration or passing package test does not prove the LAN carries UDP 5353 traffic. This evidence-only document is outside the npm `files` allowlist and does not change the 0.3.1 archive bytes.
