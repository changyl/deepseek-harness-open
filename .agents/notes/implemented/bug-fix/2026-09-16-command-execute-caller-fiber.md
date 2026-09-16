# Agent Note: Host command execution from a caller without the Remote namespace

Status: implemented

English | [中文](2026-09-16-command-execute-caller-fiber.zh.md)

## Problem

The Web command palette runs a host row through `ctx.commandUi.run(name, session)`. Picking `/plan` or any other row with no Client face failed with `cannot get property "remote.commands" without inject`, and the command never reached the Host. `run` reaches the execute transaction only for a host row that a contribution or decoration does not own, so the failure looked command-specific.

The trigger is how a Cordis Service reads its context. A method reached through the service proxy runs with `this.ctx` bound to the *caller's* fiber, and `ctx.remote.commands` is not one property read: `remote` is the Client Remote Service, whose tracker forwards `.<namespace>` to the service name `remote.<namespace>` ([Remote method calls](../architecture/2026-08-02-typert-remote-method-calls.md)). That name resolves by walking the caller fiber's service stores, which hold the services the fiber declares in `inject` and those of its ancestors. The api-gateway client half mounts each namespace on its own plugin fiber, so a caller that never names `remote.commands` has no store entry for the walk to find.

`CommandUiRuntime.execute` read `this.ctx.remote.commands`, while the directory pull in the same class read the constructor's captured `ctx`. The palette injects `commandUi` and `sessions` only, so Ctrl/Cmd+K listed every row and then failed on the rows it ran detached.

## Decision

`CommandUiRuntime` keeps its PROVIDING context in an `owner` field, and both Remote reads — the directory pull and the `command.execute` transaction — resolve the namespace through `this.owner.remote.commands`.

A caller of `ctx.commandUi.run` injects only the services it reads. The palette names `commandUi` and `sessions`; it does not declare `remote.commands` for the command service's own transport.

The same rule governs every Service method that reads `ctx.remote.<namespace>`: the namespace resolves against the caller's injected services, so the provider keeps the context its own `inject` declaration covers.

## Alternatives considered

**Declare `remote.commands` in the palette's `inject`.** The smallest diff, and it matches the [`SettingsScopeBinder`](../../../../packages/client/ui-settings/src/client/settings-scope.ts) discussion of the same hazard. Rejected because it moves the command service's transport dependency onto every composer-less caller: any later caller — another shortcut, a menu, a test-hosted surface — repeats the declaration to run a host row, and the failure returns the moment one forgets.

**Capture the `remote.commands` namespace instance in the constructor.** One lookup, typed, and no per-call resolution. Rejected because a namespace Service is remounted when its contribution fiber reloads during HMR; a captured instance would keep calling the removed namespace object, while the providing context resolves the current one on every call.

**Resolve with `this.ctx.get('remote.commands')`.** A topology-independent read that fixes the same lookup. Rejected because it adds a second access mechanism beside the `inject`-maintained fiber store, and the class already needs the providing context for the directory pull.

## Consequences

Every host command row a palette offers now reaches the Host from a caller that injects no Remote namespace, and the composer and `/` menu paths keep their existing behavior.

The [palette feature note](../feature/2026-09-14-web-command-palette.md) owns the surface that first exposed this: a composer-less caller of `ctx.commandUi.run`. Regression coverage is the `palette caller topology` case in [the runtime spec](../../../../packages/client/ui-commands/tests/service.client.spec.ts). It mounts a Service-shaped Remote double on a provider fiber — the shipped topology, and one the shared `TestRemote` double cannot express, because it provides `remote` as a plain object — and runs a host row from a fiber whose `inject` is `['commandUi']`. The case fails with the caller-fiber read and passes with the `owner` field.
