# 局域网 LLM API 公告器

[English / 完整 API 文档](README.md)

这个独立模块为已有的 LLM API 发布 `_llm-api._tcp.local` mDNS/DNS-SD 记录，可作为命令行程序运行，也可嵌入 Node.js 服务进程。它不依赖 DeepSeek Harness 或 Demo，不启动模型或 API 服务。

需要 Node.js 22 或更新版本。克隆本仓库后直接执行：

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

当前配置使用 HTTPS Open Responses profile。草案 §5.2 的通用认证提示允许 `required` 和 `none`，但 §5.3 的 Open Responses binding 明确要求 `required`；因此本项目的免 key Open Responses 是实验扩展，不宣称符合 -00 binding。发现候选会带有 `draftAuthCompatible: false` 和诊断 warning。免 key 也不等于授权，客户端仍需独立确认目标并验证 TLS。凭据、证书信任及模型能力由 API 和客户端分别处理，不通过 mDNS 分发。详情、草案出处、字段约束和嵌入示例见[英文文档](README.md)。

```sh
npm test
npm pack --dry-run
```

采用 MIT 协议；第三方组件的原始 MIT 版权与许可文本保留，见[第三方说明](THIRD_PARTY_NOTICES.md)。更新共享 core 时，按 [vendor 维护说明](vendor/README.md) 更新包版本和 lockfile。
