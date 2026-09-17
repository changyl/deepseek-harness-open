# Agent Note: Publish the project board as a Remote namespace

Status: implemented

English | [中文](2026-09-16-project-board-remote-namespace.zh.md)

## Problem

The durable project board was reachable from two places inside one process and from nowhere else. The model reads and changes it through the `project` tool in [`dsh-tool-project`](../../../../packages/project/tool-project/README.md), a person inspects it through the in-process `/project` command in [`dsh-command-project`](../../../../packages/project/command-project/README.md), and both of them talk to `ctx.projects` directly. The Web GUI, which is where a board is easiest to read, had no browser-callable surface at all, so the project capability stopped at the process boundary and every board view had to be rendered as command text.

Nothing blocked the work except the missing seam. The store already serves detached views (`list`, `get`, `board`) and derives the lanes, the ready set, and the stranded set; the Remote assembly already mounts one namespace per business capability; and [`@deepseek-ai/dsh-api-usage`](../../../../packages/api/usage/README.md) already established the shape a read-only projection of a query service takes.

## Decision

`@deepseek-ai/dsh-api-project` owns the Host Remote namespace `project`: `ProjectController` registers under the service key `projectController` with the wire namespace `project`, injecting only `['projects']`, and publishes two read methods. `list(filter?)` answers the bounded listing a board page renders as rows, and `board(id)` answers one project, its status lanes, its workable tasks, and its stranded tasks.

The controller is a projection, not an owner. Every rule the board obeys — workspace and closed-project selection, listing order, lane grouping, dependency arithmetic — stays in `ctx.projects`; the controller calls `list` and `board` and copies what they return. It holds no cache, so a client always reads the store's current state.

Four properties make the wire face safe and stable:

- **The untrusted input is validated at the wire boundary.** A strict zod schema accepts `workspace` and `includeClosed` and nothing else; a malformed payload raises `gateway/bad-request` with the codec issues, and an empty project id raises the same code instead of reaching the store.
- **The answer is bounded where the whole answer is known.** `maxProjectsListed` is a validated `Config` field on the service (schemastery, `.natural().min(1).default(20)`), and the listing slices to it and reports `truncated`, so a deployment can size the answer and the client can say the list was cut rather than implying it is complete.
- **The wire values are plain and self-contained.** `ProjectViewWire`, `ProjectTaskWire`, `ProjectSummaryWire`, `ProjectListWire`, `ProjectBoardWire`, and `ProjectFilterWire` live in `src/types.ts` with branded identities widened to strings, and the controller maps store views onto them field by field. A rename or a new field in the domain is therefore a compile error at the mapper, and the Typert generator receives types it can encode without linking the store.
- **The status unions are drift-protected by assignment.** `TaskStatus` and `ProjectStatus` are declared locally in `src/types.ts`, and the mappers assign domain values into those fields. If either union gains or loses a member, the assignment stops compiling; the wire copy cannot silently fall behind the domain.

An unknown project is `project/not-found` with `projectId` in the details, which is the one failure a client acts on by refreshing its listing; everything else about a missing record stays the store's business.

The controller is read-only. Mutations stay with `tool-project`, where every call carries the compare-and-set revision the model last read, so a stale edit is refused rather than merged. A browser mutation endpoint would need its own authority decision — which session may change which board, and how a refusal is presented — and this change deliberately does not make it.

Registration is what makes the namespace reachable, and each surface is explicit: the package manifest's generated `./typert` and `./remote` exports, `packages/api/remotes` (the client import, the type re-export, the `$mount` entry, and the three manifest sections), the `dsh-web-app` bundle (the `project-controller` Cordis row and the dependency), `tsconfig.base.json` and `tsconfig.host.json` (the aliases are hand-written because the directory name `project` does not match the package suffix `api-project`, so `gen-tsconfig-paths` cannot own them), and the catalog scripts (`SERVICE_PAGE` and `linkedTypePages` in `scripts/gen-cordis-catalog.ts`, `SERVICE_ROLES` in `scripts/gen-doc-graphs.ts`).

## Alternatives considered

**One `read` method returning the list and the board together.** A single method would either ship every task of every project — unbounded, and most of it invisible on the page that asked — or need a discriminator argument that makes the result a union the client must narrow. Two methods let each answer keep its own bound and its own wire type, which is what a list row and a board actually need.

**Expose the mutation verbs beside the reads.** `addTask`, `updateTask`, `linkSession`, `update`, and `close` all take a compare-and-set revision, and a browser endpoint would have to decide who may present one and what a refusal looks like in the UI. That is an authority decision about the product, not a serialization decision about the board, and folding it into a read-only projection would have hidden it behind a wire method.

**Derive the wire types from the domain types.** Re-exporting `ProjectView` and friends would put branded ids and domain-only fields in front of the codec, and it would make the wire contract move whenever the domain does. The usage Remote face made the same call with `UsageReportWire`, and its reason holds here: a plain copy is the place a domain rename becomes a compile error rather than a silent wire change.

**Let the store's types carry the validation.** `ctx.projects` trusts its typed callers — that is what makes it cheap — and the one caller it cannot trust is the browser. Validating in the store would add a parsed branch to every internal call; validating in the controller keeps the check at the boundary where the untrusted value enters.

**Cache the listing.** The store is in-memory and synchronous, and a listing is a walk over one table, so a cache would add a staleness window and an invalidation rule to save nothing measurable. The controller stays stateless instead.

## Consequences

The board now has a browser-callable surface under the same wire rules as every other namespace: validated requests, bounded answers, plain values, and one classified failure for the case a client must act on. A Web board panel can be built without touching the store, the tool, or the command, and the three existing consumers keep working unchanged because the store's contract did not move.

The cost is that the namespace currently has no in-repo consumer: `packages/client/ui-project` does not exist, so nothing in the shipped Web bundle calls `ctx.remote.project` yet. The registration surfaces therefore mount a namespace ahead of its client, which is why they are enumerated above rather than discovered by a caller. Read-only means the panel that arrives later can show a board but not change one until the mutation authority is decided.

The listing bound is deployment-varying by design, so two deployments can answer the same call with different lengths; `truncated` is what lets a client tell the difference between "no more projects" and "the bound was reached".

## Deferred

A client package for the board (`packages/client/ui-project`) and the mutation authority a browser edit would need are not implemented. Neither is a recorded-session snapshot for the namespace: recording needs a model key, and `evals/baseline.json` and the recorded snapshots stay untouched for that reason. No `./invariant` companion is published, because the controller owns no durable state and no relation that independent observations could diverge on — it copies what the store serves, and the store's own invariant companion owns the board's relations.

## Testing

The controller is tested through a real composition — the storage hub, the JSON backend, the domain form, the project store, and the controller over a temporary root — in seven cases: the two published methods and their service key, a listing with task and workable counts, a workspace and closed-project selection passed field by field, a listing cut by the configured bound, a malformed filter refused at the wire boundary, a board mapped onto lanes with workable tasks and their dependencies, and an empty or unknown id refused with the code a client acts on. `src/index.ts` carries per-file 100% coverage.

The build emitted both Typert faces and the remote client for the package, including the five-lane `columns` record, and the catalog generators were re-run so the namespace and its types are classified: `gen-cordis-catalog`, `gen-doc-graphs`, `gen-config-catalog`, and `gen-module-graph` all report their artifacts current.
