# Agent Note: 无 Remote 命名空间的调用方执行宿主指令

Status: implemented

[English](2026-09-16-command-execute-caller-fiber.md) | 中文

## Problem

Web 指令面板通过 `ctx.commandUi.run(name, session)` 运行宿主行。选择 `/plan` 或任何没有客户端面的行都以 `cannot get property "remote.commands" without inject` 失败，指令从未到达宿主。只有贡献（contribution）或装饰（decoration）不拥有的宿主行才会走到执行事务，因此这个故障看起来像是“某些指令”的问题。

触发条件是 Cordis Service 读取上下文的方式。通过服务代理到达的方法，其 `this.ctx` 绑定在*调用方*的 fiber 上；而 `ctx.remote.commands` 并不是一次属性读取：`remote` 是客户端 Remote Service，它的 tracker 把 `.<namespace>` 转发为服务名 `remote.<namespace>`（[Remote 方法调用](../architecture/2026-08-02-typert-remote-method-calls.zh.md)）。该名字沿着调用方 fiber 的服务存储向上查找，存储中只有该 fiber 在 `inject` 中声明的服务以及其祖先声明的服务。api-gateway 客户端半部把每个命名空间挂载在自己的插件 fiber 上，因此从未声明 `remote.commands` 的调用方在查找路径上没有对应条目。

`CommandUiRuntime.execute` 读取的是 `this.ctx.remote.commands`，而同一个类里的目录拉取读取的是构造函数捕获的 `ctx`。指令面板只注入 `commandUi` 与 `sessions`，因此 Ctrl/Cmd+K 能列出所有行，却在以分离方式运行的行上失败。

## Decision

`CommandUiRuntime` 用 `owner` 字段保存其提供方（PROVIDING）上下文，两处 Remote 读取——目录拉取与 `command.execute` 事务——都通过 `this.owner.remote.commands` 解析命名空间。

`ctx.commandUi.run` 的调用方只注入它自己读取的服务。指令面板声明 `commandUi` 与 `sessions`，不为指令服务自身的传输声明 `remote.commands`。

同一条规则适用于所有读取 `ctx.remote.<namespace>` 的 Service 方法：命名空间按调用方注入的服务解析，因此提供方保留自己的 `inject` 声明所覆盖的那个上下文。

## Alternatives considered

**在指令面板的 `inject` 中声明 `remote.commands`。** 改动最小，而且与 [`SettingsScopeBinder`](../../../../packages/client/ui-settings/src/client/settings-scope.ts) 对同类风险的讨论一致。否决原因：它把指令服务的传输依赖推给每一个无输入框的调用方——后续任何调用方（另一个快捷键、一个菜单、测试宿主的面板）为了运行宿主行都要重复声明，一旦有人忘记，故障就会回来。

**在构造函数中捕获 `remote.commands` 命名空间实例。** 一次查找、有类型，且无需每次调用解析。否决原因：HMR 期间贡献 fiber 重载会重新挂载命名空间 Service，捕获的实例会继续调用已移除的命名空间对象；而保留提供方上下文时，每次调用都解析到当前实例。

**用 `this.ctx.get('remote.commands')` 解析。** 一种与拓扑无关的读取，同样能修好这次查找。否决原因：它在 `inject` 维护的 fiber 存储之外又引入第二种访问机制，而这个类本来就需要提供方上下文来做目录拉取。

## Consequences

指令面板提供的每一行宿主指令现在都能从没有注入任何 Remote 命名空间的调用方到达宿主，输入框与 `/` 菜单路径的行为保持不变。

首次暴露该问题的是[指令面板特性记录](../feature/2026-09-14-web-command-palette.zh.md)拥有的那个界面：`ctx.commandUi.run` 的无输入框调用方。回归覆盖是[运行时规格](../../../../packages/client/ui-commands/tests/service.client.spec.ts)中的 `palette caller topology` 用例。它在提供方 fiber 上挂载一个 Service 形态的 Remote 替身——即线上拓扑，也是共享的 `TestRemote` 替身无法表达的形态，因为它把 `remote` 提供为普通对象——并从 `inject` 为 `['commandUi']` 的 fiber 运行一行宿主指令。该用例在调用方 fiber 读取下失败，在 `owner` 字段下通过。
