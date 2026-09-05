# spike-v5

A throwaway measurement, not the start of v5.

One vertical slice of the `planning/incubator/gatesai-chat-v5` design — a
single chat turn through transport, domain and a persistence adapter — built
from scratch so the design could be measured against the shipping app instead
of argued about. It imports nothing from `src/` and `src/` imports nothing
from it.

Read [`FINDINGS.md`](FINDINGS.md) for the result. Short version: adopt the
layering (53 interface members on the v4 turn path against 10 here), drop the
"extract the core and keep the tests" premise.

## Run the test

```sh
npx vitest run --config spike-v5/vitest.config.ts
```

It uses the repository's installed vitest and adds no dependency. The suite
runs under `environment: 'node'` — a headless core that needs a DOM to run
its own tests is not headless, so that setting is part of what is being
tested.

## Layout

| Path | Ring | Depends on |
|---|---|---|
| `src/domain/` | pure core | nothing |
| `src/transport/` | adapter | `domain/ports` |
| `src/persistence/` | adapter | `domain/ports`, `domain/model` |
| `src/runtime/` | composition root | all of the above |
| `src/index.ts` | published seam | — |

## Disposal

This directory has an ending written into it: once the adopt/adapt/drop
decision in `FINDINGS.md` is recorded against the incubator folder, delete or
archive it. A spike that is still around in three months is a second codebase.
