# hypermedia

**Hypermedia for the CLI** is wd's organizing principle: every command
emits not only its result but also pointers to *what could happen next*
and *where to learn more*. The CLI is meant to be navigable — by humans
reading terminal output, and by agents consuming JSON.

Concretely:

- **`next` arrays** — every successful command suggests follow-up commands
  in both text mode (`Next: wd deploy --stage dev`) and JSON mode
  (`"next": [{ "cmd": "wd deploy --stage dev", "why": "ship the apply" }]`).
- **`errors[].doc`** — every error in JSON mode carries a self-resolving
  doc pointer (`"doc": "wd explain WD_E_STATE_MISSING"`).
- **`wd actions`** — the sitemap. Returns every command, its category, its
  required state, and the commands it commonly leads to. Use it to teach
  agents the navigation graph in one fetch.
- **`wd explain <topic>`** — the concept dictionary, this very page included.
  Each concept ends in a `See also` section so the graph closes.
- **`wd schema outputs`** — the typed shape of every JSON response.

Why this matters: a hypermedia CLI lets an agent operate by *exploration*
instead of by *memorization*. It does not need to be re-trained when
commands change, because each command tells it what to do next.

## Exceptions

- `wd dev` is long-running and stream-oriented. In `--json` mode it emits
  one startup envelope and then NDJSON events; it does not produce a
  single terminal envelope.
- `wd tail` and `wd logs --tail` similarly stream — startup envelope only.

## See also

- Commands: `wd actions`, `wd explain`, `wd schema outputs`, `wd tools`
- Concepts: `wd explain stages`, `wd explain state`
