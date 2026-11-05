# LLM API advertiser

[中文](README.zh-CN.md) · [Website](https://nobrowning.github.io/llm-service-discovery-demo/) · [Full guide](https://github.com/nobrowning/llm-api-advertiser/blob/main/docs/guide.md)

Make an LLM API you already run show up in AI apps on your local network, the way a network printer shows up in a print dialog.

## Why

You run a model server on a workstation or a GPU machine. Today, everyone who wants to use it needs its address, port and path, and has to update their settings whenever any of these change or they move to another network.

The advertiser announces your API on the local network with mDNS/DNS-SD, using the service type `_llm-api._tcp`. Apps that support discovery list it on their own, and drop it when you stop announcing. Users still choose whether to connect, and their app checks the HTTPS connection first.

## What it does

- Publishes the records that describe each API: name, host, port, base path, API type, and whether a key is needed.
- Announces several APIs from one machine, each with its own path and key policy.
- Checks for name conflicts at startup, answers queries, and withdraws the records when it stops.
- Runs as a command-line tool or inside a Node.js service process.

It never publishes keys. It does not start your API, watch its health, or change firewall, DNS or certificate settings.

## Quick start

You need Node.js 22 or later, and an LLM API that is already reachable over HTTPS. Download `llm-discovery-advertiser-0.3.1.tgz` and `SHA256SUMS` from [Releases](https://github.com/nobrowning/llm-api-advertiser/releases), then in an empty folder:

```sh
npm install --offline --ignore-scripts --no-audit --no-fund ./llm-discovery-advertiser-0.3.1.tgz
npx --no-install llm-api-advertise --list-interfaces
npx --no-install llm-api-advertise --example my-services.json
```

Edit `my-services.json` to describe your API:

```json
{
  "interfaceAddress": "192.168.1.20",
  "services": [{
    "id": "text",
    "instanceName": "Studio Qwen3 8B",
    "hostname": "studio-llm.local",
    "address": "192.168.1.20",
    "port": 8443,
    "basePath": "/v1",
    "auth": "required"
  }]
}
```

Use your machine's LAN IPv4 address from the list, and a `.local` host name that matches the API's TLS certificate. Then check the file and start announcing:

```sh
npx --no-install llm-api-advertise --config ./my-services.json --check
npx --no-install llm-api-advertise --config ./my-services.json --interface 192.168.1.20
```

Press Ctrl+C to withdraw the announcement.

## Use it inside a Node.js service

```js
import { createAdvertiser } from '@llm-discovery/advertiser';
import { validateAdvertiserConfig } from '@llm-discovery/advertiser/config';

const config = validateAdvertiserConfig({ /* same fields as the JSON file */ });
const advertiser = createAdvertiser(config);
await advertiser.start();                    // after your HTTPS listener is ready
await advertiser.setEnabled('text', false);  // when the API stops serving
await advertiser.stop();                     // on shutdown
```

## Learn more

- [Full guide](https://github.com/nobrowning/llm-api-advertiser/blob/main/docs/guide.md): installing from source, every configuration field, embedding, platforms and troubleshooting.
- [Technical details](https://nobrowning.github.io/llm-service-discovery-demo/technical.html): records, TXT keys and the discovery flow.
- [Platform validation](https://github.com/nobrowning/llm-api-advertiser/blob/main/docs/platform-validation.md).

## Status

Experimental implementation of the IETF Internet-Draft [draft-cui-dawn-local-llm-api-discovery-00](https://datatracker.ietf.org/doc/draft-cui-dawn-local-llm-api-discovery/). IPv4 only; clients must be on the same local network. `auth=none` for an Open Responses API is a project experiment: the draft's Open Responses binding requires `auth=required`.

## Part of Local LLM API Discovery

| Repository | What it does |
|---|---|
| **llm-api-advertiser** (this repository) | Announces an LLM API on the local network. Runs next to the server. |
| [llm-discovery-core](https://github.com/nobrowning/llm-discovery-core) | Finds and checks announced services. A library for client apps. |
| [dsh-lan-discovery](https://github.com/nobrowning/dsh-lan-discovery) | Lists LAN services inside DeepSeek Harness and connects the one you choose. |
| [llm-service-discovery-demo](https://github.com/nobrowning/llm-service-discovery-demo) | Runnable demo with simulated APIs, and the project website. |

## Development

```sh
npm ci --ignore-scripts
npm test
npm run release:prepare
```

## License

MIT. Third-party packages keep their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
