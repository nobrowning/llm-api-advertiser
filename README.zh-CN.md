# LLM API 公告器

[English](README.md) · [项目网站](https://nobrowning.github.io/llm-service-discovery-demo/?lang=zh) · [完整说明](https://github.com/nobrowning/llm-api-advertiser/blob/main/docs/guide.zh-CN.md)

让你已经在运行的 LLM API 出现在局域网里的 AI 应用中，就像网络打印机出现在打印对话框里一样。

## 为什么需要

你在一台工作站或 GPU 机器上部署了模型服务。现在，想用它的人都得知道它的地址、端口和路径；这些信息一变，或者他们换了网络，就得重新改配置。

公告器通过 mDNS/DNS-SD，以 `_llm-api._tcp` 服务类型在局域网中公告你的 API。支持发现的应用会自动把它列出来，停止公告后它会从列表中消失。是否接入仍由用户选择，用户的应用会先检查 HTTPS 连接。

## 它做什么

- 发布描述每个 API 的记录：名称、主机、端口、base 路径、API 类型，以及是否需要 key。
- 一台机器可以公告多个 API，各自有独立的路径和 key 策略。
- 启动时检查名称冲突，应答查询，停止时撤销记录。
- 可以作为命令行工具运行，也可以嵌入 Node.js 服务进程。

它从不公告 key，也不启动你的 API、不监测 API 健康状态，不修改防火墙、DNS 或证书设置。

## 快速开始

需要 Node.js 22 或更新版本，以及一个已经可以通过 HTTPS 访问的 LLM API。从 [Releases](https://github.com/nobrowning/llm-api-advertiser/releases) 下载 `llm-discovery-advertiser-0.3.1.tgz` 和 `SHA256SUMS`，在一个空目录中运行：

```sh
npm install --offline --ignore-scripts --no-audit --no-fund ./llm-discovery-advertiser-0.3.1.tgz
npx --no-install llm-api-advertise --list-interfaces
npx --no-install llm-api-advertise --example my-services.json
```

编辑 `my-services.json`，填写你的 API：

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

地址使用上面列表中本机的局域网 IPv4，`.local` 主机名要与 API 的 TLS 证书一致。然后检查配置并开始公告：

```sh
npx --no-install llm-api-advertise --config ./my-services.json --check
npx --no-install llm-api-advertise --config ./my-services.json --interface 192.168.1.20
```

按 Ctrl+C 撤销公告。

## 嵌入 Node.js 服务

```js
import { createAdvertiser } from '@llm-discovery/advertiser';
import { validateAdvertiserConfig } from '@llm-discovery/advertiser/config';

const config = validateAdvertiserConfig({ /* 与 JSON 文件相同的字段 */ });
const advertiser = createAdvertiser(config);
await advertiser.start();                    // HTTPS 服务就绪后调用
await advertiser.setEnabled('text', false);  // API 停止服务时
await advertiser.stop();                     // 进程退出时
```

## 更多

- [完整说明](https://github.com/nobrowning/llm-api-advertiser/blob/main/docs/guide.zh-CN.md)（[英文版更详细](https://github.com/nobrowning/llm-api-advertiser/blob/main/docs/guide.md)）：从源码安装、全部配置字段、嵌入方式、平台与排错。
- [技术细节](https://nobrowning.github.io/llm-service-discovery-demo/technical.html?lang=zh)：记录、TXT 字段与发现流程。

## 项目状态

IETF 互联网草案 [draft-cui-dawn-local-llm-api-discovery-00](https://datatracker.ietf.org/doc/draft-cui-dawn-local-llm-api-discovery/) 的实验性实现。仅支持 IPv4，客户端须在同一局域网内。Open Responses API 使用 `auth=none` 属于本项目的实验：草案的 Open Responses 绑定要求 `auth=required`。

## 所属项目：局域网 LLM API 发现

| 仓库 | 作用 |
|---|---|
| **llm-api-advertiser**（本仓库） | 在局域网中公告 LLM API，运行在服务端旁边。 |
| [llm-discovery-core](https://github.com/nobrowning/llm-discovery-core) | 发现并校验公告的服务，供客户端应用使用的库。 |
| [dsh-lan-discovery](https://github.com/nobrowning/dsh-lan-discovery) | 在 DeepSeek Harness 中列出局域网服务，并接入你选择的那个。 |
| [llm-service-discovery-demo](https://github.com/nobrowning/llm-service-discovery-demo) | 使用模拟 API 的可运行 Demo，以及项目网站。 |

## 开发

```sh
npm ci --ignore-scripts
npm test
npm run release:prepare
```

## 许可

MIT。第三方组件保留各自的许可，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
