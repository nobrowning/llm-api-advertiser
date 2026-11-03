# 局域网 LLM API 公告器

[English / 完整 API 文档](README.md)

这个独立模块为已有的 LLM API 发布 `_llm-api._tcp.local` mDNS/DNS-SD 记录，可作为命令行程序运行，也可嵌入 Node.js 服务进程。它不依赖 DeepSeek Harness 或 Demo，不启动模型或 API 服务。

需要 Node.js 22 或更新版本。普通部署可从 [GitHub Releases](https://github.com/nobrowning/llm-api-advertiser/releases) 下载 `llm-discovery-advertiser-0.3.1.tgz` 和 `SHA256SUMS`。在新建的工作目录中安装下载包：

```sh
npm install --offline --ignore-scripts --no-audit --no-fund ./llm-discovery-advertiser-0.3.1.tgz
npx --no-install llm-api-advertise --help
```

包内包含核心库和全部 JavaScript 运行依赖，无需另装其他仓库，也无需访问 npm registry。Windows、macOS（Intel / Apple Silicon）、Linux（x64 / ARM64）使用同一份安装包；Node.js 运行时需选择与 CPU 匹配的版本，不需要 Docker、WSL 或原生编译。先列出本机 IPv4 并生成示例文件：

```sh
npx --no-install llm-api-advertise --list-interfaces
npx --no-install llm-api-advertise --list-interfaces --json
npx --no-install llm-api-advertise --example my-services.json
```

`--example FILE` 写入 UTF-8，不覆盖已有文件；省略文件名则向标准输出打印 JSON。修改示例中的 IP、主机名和 API 设置，选择上一步列出的局域网 IPv4 地址，而不是 `en0`、`eth0` 等网卡名称。然后执行：

```sh
npx --no-install llm-api-advertise --config ./my-services.json --check
npx --no-install llm-api-advertise --config ./my-services.json --interface 192.168.1.20
```

Linux 使用 `sha256sum --check SHA256SUMS` 校验下载包；macOS 使用 `shasum -a 256 -c SHA256SUMS`；Windows 使用 `Get-FileHash .\llm-discovery-advertiser-0.3.1.tgz -Algorithm SHA256`，与校验文件中的值比较。此工具只公告已有 API，不包含模型或 API 服务。

也可以克隆本仓库后从源码安装：

```sh
npm ci --ignore-scripts
node cli.mjs --help
node cli.mjs --config ./examples/advertiser.json --check
```

共享 discovery-core 的版本化包已经放在 `vendor/`，不需要先发布到 npm，也不需要同时克隆其他仓库。npm 会按 lockfile 下载第三方依赖。

把示例复制为自己的 JSON 配置，替换 IP、`.local` 主机名、端口及 API 路径，再从**服务节点**启动公告：

```sh
node cli.mjs --config ./my-services.json --interface 192.168.1.20
```

示例中的两个服务属于同一台机器：`/text/v1` 设置 `auth: "required"`，`/vision/v1` 设置 `auth: "none"`，分别演示需要 key 和免 key 的 API。省略 `auth` 时默认 `required`，其他值拒绝。公告设置必须与 API 实际策略一致，它不会改变服务器的认证行为。`--check` 只校验配置，不产生网络公告。实际公告地址必须能被客户端访问，接口地址属于公告器运行的网络环境。按 Ctrl+C 或发送 SIGTERM 会撤销公告；CLI 不自动检查 API 健康状态，API 停止时应同时停止公告器。

实际启动前会检查选中 IPv4 仍属于本机；`--check` 只检查语法，不检查网卡是否存在。没有指定接口时按共享核心库的顺序选择首个非回环 IPv4，替代旧版本依赖内的系统默认选择。VPN、Docker、Wi-Fi 与有线网并存时务必明确指定。地址变化后更新配置再重启，公告器不会自动修改 API 的公告地址。

CI 已配置 Windows x64、Linux x64/ARM64、macOS ARM64/Intel，Node.js 22 在 Linux x64 验证下限、Node.js 24 覆盖所有平台；通过情况以 Actions 记录为准。安装及模拟网络测试不能代替真实局域网验收：此前 Windows/WSL Demo 的记录不表示 Bonjour/Avahi 共存或 macOS/Linux 跨机发现已经验收，实际结果见 Demo 验证报告。保留系统 mDNS 服务进行共存检查，确认 `224.0.0.251:5353/UDP` 与 API 流量可达。目前仅支持 IPv4、不支持跨子网发现；工具不会修改防火墙、路由、系统 DNS 或局域网权限。

当前配置使用 HTTPS Open Responses profile。草案 §5.2 的通用认证提示允许 `required` 和 `none`，但 §5.3 的 Open Responses binding 明确要求 `required`；因此本项目的免 key Open Responses 是实验扩展，不宣称符合 -00 binding。发现候选会带有 `draftAuthCompatible: false` 和诊断 warning。免 key 也不等于授权，客户端仍需独立确认目标并验证 TLS。凭据、证书信任及模型能力由 API 和客户端分别处理，不通过 mDNS 分发。详情、草案出处、字段约束和嵌入示例见[英文文档](README.md)。

```sh
npm test
npm run release:prepare
```

发行检查会检查文件白名单与依赖、验证重复打包字节一致，并在空 npm 缓存的隔离目录内离线安装最终包，验证导出与 CLI。产物和 `SHA256SUMS` 位于 `.release-artifacts/`。版本 tag 会触发创建待审阅的 GitHub Release 草稿，不会发布到 npm。

采用 MIT 协议；第三方组件的原始 MIT 版权与许可文本保留，见[第三方说明](THIRD_PARTY_NOTICES.md)。更新共享 core 时，按 [vendor 维护说明](vendor/README.md) 更新包版本和 lockfile。
