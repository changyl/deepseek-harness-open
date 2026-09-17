---
description: "The usage package group: the ctx.usage query service, its durable ledger provider, the deployment-owned pricing table, and the human /usage command."
kind: "package-group"
---

# usage/ — token totals and cost

English | [中文](README.zh.md)

## Summary

The usage group answers one question for a deployment: how many tokens were spent, on which route, and what they cost. `dsh-usage` owns the report contract on `ctx.usage`; `dsh-usage-ledger` supplies durable per-session token facts folded from canonical logs; `dsh-usage-pricing` supplies the deployment's rate card, and `dsh-command-usage` renders the same report for people through `/usage`. Cost is computed at read time, so no stored record carries a price, and a route the table does not name is reported unpriced rather than free.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`usage/`](usage/README.md) | Report contract, registration, and read-time cost arithmetic | `ctx.usage` |
| [`usage-ledger/`](usage-ledger/README.md) | Durable provider: one token-fact record per session folded from its canonical log | registers on `ctx.usage` |
| [`usage-pricing/`](usage-pricing/README.md) | Deployment-owned rate card, optionally re-read from the `usage-pricing` settings namespace | registers on `ctx.usage` |
| [`command-usage/`](command-usage/README.md) | Human `/usage` command rendering totals, routes, and cost in the UI | registers on `ctx.commands` |

The service and the ledger ship in the base bundle and answer queries without a rate card; every contributing route is then reported unpriced and a report carries no cost. The pricing table and the command are opt-in, because rates are deployment data and the command needs an interactive command adapter.

-----

<a id="related-documentation"></a>
## Related documentation

- [Usage subsystem](../../docs/subsystems/usage.md) — the report, pricing, and provider contracts with their exact fields.
- [Storage subsystem](../../docs/subsystems/storage.md) — the domain form that holds the ledger's derived records.
- [Session query subsystem](../../docs/subsystems/session-query.md) — the canonical-log reads the ledger folds.
- [Human commands subsystem](../../docs/subsystems/commands.md) — the registry the `/usage` command registers into.
- [Packages map](../README.md) — every package group and its role.

<a id="dev-note"></a>
## Dev Note

None.
