---
"wrangler-deploy": patch
---

Improve lifecycle safety and capability visibility for resource adoption.

- Enforce `adopt` support by resource type and fail fast when unsupported.
- Add `adopt` capability metadata to CLI schema output.
- Persist and surface adopt lifecycle metadata in state output.
- Keep `delete: false` behavior reliable when resources are removed from manifest.
