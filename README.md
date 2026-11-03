# Local LLM API advertiser

[中文快速开始](README.zh-CN.md)

A reusable Node.js library and command-line announcer for existing local LLM API services. It publishes `_llm-api._tcp.local` PTR, SRV, TXT and address records with mDNS. It has no dependency on DeepSeek Harness, Docker, the mock API, or the demo controller.

This is an experimental implementation using `txtvers=1`, `api=openresponses`, `protovers=2026-04-24`, and `scheme=https`. The per-service authentication hint is `auth=required` by default, or explicitly `auth=none` for an API that does not require a key. Announcing an endpoint does not make an incompatible API conform to that profile.

The [draft's TXT table](https://datatracker.ietf.org/doc/html/draft-cui-dawn-local-llm-api-discovery-00#section-5.2) defines both auth values, while its [Open Responses binding](https://datatracker.ietf.org/doc/html/draft-cui-dawn-local-llm-api-discovery-00#section-5.3) requires `required`. Open Responses with `auth=none` is therefore a **local experimental extension**, not compliance with the draft-00 binding. The shared discovery client marks this with `draftAuthCompatible: false` and a validation warning. No-key access still requires the client's independent endpoint authorization and TLS checks.

## Install

Download `llm-discovery-advertiser-0.3.0.tgz` and `SHA256SUMS` from [GitHub Releases](https://github.com/nobrowning/llm-api-advertiser/releases). With Node.js 22 or later and npm installed, create a working directory, place the archive there, and run:

```sh
npm install --offline --ignore-scripts --no-audit --no-fund ./llm-discovery-advertiser-0.3.0.tgz
npx --no-install llm-api-advertise --help
```

The archive includes the shared core and all JavaScript runtime dependencies. You do not need another source checkout, a separately installed core, or npm registry access to install it. Node.js itself is not bundled. The package is distributed through GitHub Releases and is not published to the npm registry.

Copy `node_modules/@llm-discovery/advertiser/examples/advertiser.json` to `my-services.json`, edit it for your API, then validate and announce it:

```sh
npx --no-install llm-api-advertise --config ./my-services.json --check
npx --no-install llm-api-advertise --config ./my-services.json --interface 192.168.1.20
```

On Linux, verify the downloaded archive with `sha256sum --check SHA256SUMS`. On Windows, compare `(Get-FileHash .\llm-discovery-advertiser-0.3.0.tgz -Algorithm SHA256).Hash` with the entry in `SHA256SUMS`. The archive runs the announcer only; your actual API and its TLS/authentication settings are still required.

### From source

Requires Node.js 22 or newer. Clone this repository and run the following commands from its root. The versioned discovery-core archive is committed under `vendor/`, so no sibling checkout or prior npm publication of core is needed. npm downloads the locked third-party dependencies normally.

```sh
npm ci --ignore-scripts
node cli.mjs --help
```

When installing the supplied package archive in another project, npm also installs its packaged shared-core dependency. The installed executable is `llm-api-advertise`; use `npx --no-install llm-api-advertise --help` in that project.

The archive produced by `npm pack` bundles discovery-core and its dependency tree. The source repository's `vendor/` archive is an input to that build; see [vendor provenance and updates](vendor/README.md). This package is not assumed to exist on the public npm registry.

## Announce your API

Copy `examples/advertiser.json` and replace its illustrative IP, hostname, port, paths and names with your own deployment. It shows two independent services on one host: `/text/v1` requires authentication, while `/vision/v1` is a no-key experimental service. Set each hint to match the actual API policy; the announcer does not change that policy. Neither the API server nor its model weights are started by this command.

```sh
node cli.mjs --config ./examples/advertiser.json --check
node cli.mjs --config ./my-services.json --interface 192.168.1.20
```

`--check` validates the file and exits without opening a network socket. `--interface` overrides the JSON field. With neither field nor flag, multicast-dns uses its default outgoing interface; explicitly selecting the service node's LAN interface is preferable on machines with several networks.

Run the announcer on the **service node**, after the API is ready. The published `address` must be reachable from clients and the interface address must belong to the announcer's host/network namespace. In a container, both refer to that container's network context; the network must carry mDNS to the clients and the advertised API port must be reachable. The demo documents one verified Windows/WSL topology; arbitrary Docker Desktop bridge networks are not claimed to support multicast discovery.

Press Ctrl+C or send SIGTERM to withdraw the announcement and close the socket. The process emits JSON events and exits nonzero on configuration/startup failure or a repeated ownership conflict. Abrupt termination cannot send a goodbye; cached records then expire by TTL.

The CLI advertises static configuration and does not poll API health. Stop it when its API is stopped. For applications with changing readiness, use the library and call `setEnabled` as readiness changes.

### Configuration

| Field | Meaning |
|---|---|
| `interfaceAddress` | Optional outgoing IPv4 interface on the service node. |
| `ttl` | Record lifetime in seconds, default 120; CLI permits 1–4500. |
| `services` | One to 128 service objects. |
| `services[].id` | Unique internal identifier for enabling/withdrawing a service. |
| `services[].instanceName` | Unique DNS-SD instance label, at most 63 UTF-8 bytes; use hyphens instead of literal dots. |
| `services[].hostname` | Valid `.local` host name used as the SRV target. Must agree with the API's TLS certificate. |
| `services[].address` | Explicit non-loopback unicast IPv4 address reachable from clients. |
| `services[].port` | API port, 1–65535. |
| `services[].basePath` | API base path, default `/v1`; `/` is allowed; other trailing slashes, queries, fragments and traversal are rejected. |
| `services[].auth` | Authentication hint: `required` (default) or `none`; unknown values are rejected. No credential value belongs here. |
| `services[].enabled` | Optional initial announcement state, default `true`. |

Services sharing a hostname must share its address. Each independent API has its own instance name; differences in port or base path distinguish endpoints. Configuration is limited to 64 KiB. Unknown fields are rejected, so credentials cannot accidentally become arbitrary TXT data. The CLI currently validates IPv4 deployment configuration; IPv6 interoperability has not been demonstrated.

## Embed in a service process

```js
import { createAdvertiser } from '@llm-discovery/advertiser';
import { validateAdvertiserConfig } from '@llm-discovery/advertiser/config';

const config = validateAdvertiserConfig({
  interfaceAddress: '192.168.1.20',
  services: [{
    id: 'text', instanceName: 'Studio Qwen3 8B',
    hostname: 'studio-llm.local', address: '192.168.1.20',
    port: 8443, basePath: '/v1', auth: 'required',
  }],
});
const advertiser = createAdvertiser({ ...config, logger: event => console.log(event) });
await advertiser.start(); // call after your HTTPS listener is ready

// When readiness changes:
await advertiser.setEnabled('text', false);
await advertiser.setEnabled('text', true);

// In your application's shutdown path:
await advertiser.stop();
```

The library probes for ownership conflicts, sends initial announcements, handles matching questions and known-answer suppression, and withdraws only records no longer used by another enabled service. `start()` resolves after initial probing and announcements; `stop()` sends goodbye records where appropriate. `status` is `stopped`, `probing`, or `announcing`. `logger` is optional and receives protocol lifecycle events, not API requests.

## Trust and capability boundaries

mDNS announces connection hints. It does not authenticate a service, deliver tokens, establish certificate trust, or prove model capabilities. Configure API authentication/TLS independently and have clients retrieve models/capabilities after their normal authorization and connection checks. `auth=none` describes the API's credential requirement, not permission to use an arbitrary endpoint. Do not put tokens, certificate private keys or user data in instance names or configuration. No firewall, DNS, credential-store or system security settings are modified.

## Development

```sh
npm test
npm run release:prepare
```

`release:prepare` checks the package allowlist and bundled dependency set, checks reproducible archive bytes, and installs the final archive offline into an isolated temporary project with an empty npm cache. It checks the installed exports and CLI `--help` / `--check` without opening a multicast socket. The archive and `SHA256SUMS` are written to `.release-artifacts/`; an optional output directory can be supplied after `--`. A matching version tag (for example `v0.3.0`) runs the same checks and creates a draft GitHub Release for review. The workflow never publishes to npm.

MIT licensed. The shared discovery-core dependency and this announcer are separate reusable packages; the demonstration is a separate consumer.

Third-party packages keep their original MIT copyright and license texts. Copies and package versions are recorded in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md); the project license does not replace them. CI runs installation, tests and package inspection on Linux and Windows with Node.js 22 and 24.
