---
description: "用量包组：ctx.usage 查询服务、其持久账本提供方、部署自有的定价表，以及人类 /usage 命令。"
kind: "package-group"
---

# usage/ — token 合计与成本

[English](README.md) | 中文

## 概述

用量组为部署回答一个问题：花了多少 token、花在哪个路由上、成本是多少。`dsh-usage` 拥有 `ctx.usage` 上的报告契约；`dsh-usage-ledger` 提供从规范日志折叠出的每会话持久 token 事实；`dsh-usage-pricing` 提供部署自有的费率卡，`dsh-command-usage` 则通过 `/usage` 为人们渲染同一份报告。成本在读取时计算，因此没有记录携带价格，定价表未命名的路由被报告为未定价而非免费。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx key |
|---|---|---|
| [`usage/`](usage/README.zh.md) | 报告契约、注册与读取时成本算术 | `ctx.usage` |
| [`usage-ledger/`](usage-ledger/README.zh.md) | 持久提供方：从规范日志为每个会话折叠出一条 token 事实记录 | 注册到 `ctx.usage` |
| [`usage-pricing/`](usage-pricing/README.zh.md) | 部署自有的费率卡，可选地从 `usage-pricing` 设置命名空间重新读取 | 注册到 `ctx.usage` |
| [`command-usage/`](command-usage/README.zh.md) | 人类 `/usage` 命令，在界面中渲染合计、路由与成本 | 注册到 `ctx.commands` |

服务与账本随基础 bundle 发布，并在没有费率卡时也能回答查询；此时每个贡献路由都被报告为未定价，报告不携带成本。定价表与命令是可选项，因为费率属于部署数据，而命令需要交互式命令适配器。

-----

<a id="related-documentation"></a>
## 相关文档

- [用量子系统](../../docs/subsystems/usage.zh.md)——报告、定价与提供方契约及其确切字段。
- [存储子系统](../../docs/subsystems/storage.zh.md)——保存账本派生记录的域形式。
- [会话查询子系统](../../docs/subsystems/session-query.zh.md)——账本折叠所读取的规范日志。
- [人类命令子系统](../../docs/subsystems/commands.zh.md)——`/usage` 命令注册进的注册表。
- [包映射](../README.zh.md)——每个包组及其职责。

<a id="dev-note"></a>
## 开发备注

无。
