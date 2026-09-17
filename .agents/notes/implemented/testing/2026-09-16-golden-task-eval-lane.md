# Agent Note: Measure model effectiveness with golden tasks

Status: implemented

English | [中文](2026-09-16-golden-task-eval-lane.zh.md)

## Problem

The harness could prove two things about a change: that its own code stays fast (`benchmarks/`, which runs synthetic inputs with no model) and that a recorded session still produces the same transcript (`snapshots/`, which replays without a key). Neither answers the question a deployment actually asks about a model: given this task in this workspace, did it get solved?

A transcript can be byte-identical while the file the task asked for is wrong, because a snapshot compares the conversation, not the result. And a snapshot has no notion of a score, a baseline, or a cost, so nothing could say whether a change to a prompt, a tool description, or a model route made outcomes better or worse. The [effectiveness projection](../../../../packages/feedback/effectiveness/README.md) covers what a session's own signal says about it; it cannot tell whether the work was correct.

## Decision

A top-level `evals/` tree owns golden-task evaluation, and the root exposes it as `pnpm run test:eval` plus `pnpm run test:eval:update-baseline`.

One case is one directory under `evals/cases/`: `task.md` is the prompt, `eval.yml` carries the profile, the turn and time ceilings, and the assertions, and `workspace/` is the pristine fixture. The runner copies the fixture into a fresh temporary directory per case, hands that directory to an injected executor, and evaluates the assertions against what the run left behind: file presence, file content, absence, a hash comparison against the fixture bytes, and a command's exit code and pinned stdout. Nothing parses the model's prose, so a case cannot pass because the model said it succeeded.

The executor is the shipped headless profile: the lane spawns the CLI with a private `DSH_HOME`, so the run cannot see or damage the developer's sessions, and then measures the run from its own durable log — the `turn/end` count and the provider-reported token buckets — rather than from stdout. When a deployment keeps `evals/rates.json`, the lane prices those buckets through the usage seam's own `routeCostMicros`, so the cost figure comes from the same arithmetic the product uses.

`evals/baseline.json` records the last accepted per-case status. The lane fails when a case recorded as `passed` now fails, and reports cases the baseline does not know and baseline cases the run did not cover without failing on either, because a failing case may legitimately start passing.

The lane calls a real model, so it self-skips with a clear message and exit code 0 when `DEEPSEEK_API_KEY` is absent, exactly like the e2e lane. A green run in a keyless environment means "not measured", never "passing".

## Alternatives considered

**Extend `benchmarks/` with correctness cases.** That tree exists to catch performance regressions: fixed synthetic inputs, no model, no network, and budgets that environment variables may not override. A model call is neither deterministic nor budget-shaped, and putting one there would make every performance gate depend on a provider. Two trees, two questions.

**Reuse the session-snapshot lane.** Snapshots pin a transcript, and their fixtures are recorded sessions replayed keylessly, which is exactly what makes them cheap and deterministic. They assert nothing about the files a run produced beyond an explicit workspace comparison, and they have no scoring or baseline notion. The lane keeps the part that transfers — run the shipped profile in a fresh workspace — and adds the assertions and the score.

**Ship the lane as a package rather than a tree.** A package would join the release family, the workspace constraints, and the per-file coverage gate, none of which fit tooling that spawns the CLI. The tree keeps the same testing standard without pretending the lane is product surface.

**Execute the task in-process instead of a subprocess.** An in-process run inherits the harness's own working directory, environment, and loaded composition, so a case could pass because the developer's session happened to be configured the right way. A subprocess with a private home and a copied workspace is the only shape in which the case's inputs are exactly the case's inputs.

**Grade the transcript instead of the workspace.** Asking a second model to judge the run adds a second nondeterministic step to a measurement that exists to be comparable across runs, and it would make the score depend on the judge's route. Files, exit codes, and stdout are boring and comparable.

## Consequences

Model effectiveness now has a home, a score, and a regression gate: pass rate, tokens per solved case, and cost per solved case, all derived from evidence the run itself produced. A prompt or tool-description change can be evaluated by running the same cases before and after.

The honesty of the lane depends on its cases and on a key. A keyless run proves only that the lane is wired correctly. Three cases measure three narrow capabilities, not a model. The cost figure appears only when the deployment keeps a rate card, and the token figures are provider-reported for the steps that reported usage. The lane also spends real tokens, so it is an owner-run lane rather than a per-PR gate until a deployment decides otherwise.

## Testing

The lane's own logic is covered without a model: case loading and its rejections, every assertion kind including the path-escape refusal and the pinned-stdout check, the suite's workspace isolation and unchanged-bytes semantics, the crashed-executor path, scoring and baseline comparison, the report, and the session-log fold with pricing. The keyless path is exercised by running `pnpm run test:eval` with no key: it compares the task digests, reports drift as a failure, and otherwise reports the skip and exits zero.
