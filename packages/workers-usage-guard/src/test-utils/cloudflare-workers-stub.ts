// Minimal stub for `cloudflare:workers` used only in vitest unit tests.
// The real module is provided by the Cloudflare Workers runtime.
export abstract class WorkflowEntrypoint<_Env = unknown, _T = unknown> {
  protected ctx!: unknown;
  protected env!: _Env;
  abstract run(event: unknown, step: unknown): Promise<unknown>;
}
