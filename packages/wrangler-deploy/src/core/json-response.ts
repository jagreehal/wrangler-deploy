/**
 * Unified JSON response envelope for wrangler-deploy commands.
 *
 * Every machine-readable response across the CLI eventually flows through this
 * shape. It is intentionally hypermedia-flavored: `next` and `errors[].doc`
 * give callers (humans and agents) a clickable path through the state graph.
 *
 * See `wd explain hypermedia` for the design rationale.
 */

export interface WdJsonError {
  code: string;
  message: string;
  fix?: string;
  /** Pointer to a richer explanation: typically `wd explain <code>`. */
  doc?: string;
}

export interface WdJsonNext {
  /** A wd command the caller can run next, e.g. `"wd deploy --stage dev"`. */
  cmd: string;
  /** A short rationale shown to humans and consumed by agents. */
  why: string;
}

export interface WdJsonWarning {
  code?: string;
  message: string;
}

export interface WdJsonMeta {
  stage?: string;
  wdVersion: string;
  durationMs: number;
  /** Bumped when the envelope's shape changes in a breaking way. */
  schemaVersion: "1";
}

export interface WdJsonResponse<TResult = unknown> {
  command: string;
  ok: boolean;
  result?: TResult;
  errors?: WdJsonError[];
  next?: WdJsonNext[];
  warnings?: WdJsonWarning[];
  meta: WdJsonMeta;
}

export interface BuildOptions {
  command: string;
  startedAt: number;
  wdVersion: string;
  stage?: string;
  next?: WdJsonNext[];
  warnings?: WdJsonWarning[];
}

/** Build a successful response envelope. */
export function makeOk<TResult>(
  result: TResult,
  options: BuildOptions,
): WdJsonResponse<TResult> {
  return {
    command: options.command,
    ok: true,
    result,
    ...(options.next && options.next.length > 0 ? { next: options.next } : {}),
    ...(options.warnings && options.warnings.length > 0 ? { warnings: options.warnings } : {}),
    meta: {
      ...(options.stage ? { stage: options.stage } : {}),
      wdVersion: options.wdVersion,
      durationMs: Math.max(0, Math.round(performance.now() - options.startedAt)),
      schemaVersion: "1",
    },
  };
}

/** Build a failure response envelope. */
export function makeErr(
  errors: WdJsonError[],
  options: BuildOptions,
): WdJsonResponse<never> {
  return {
    command: options.command,
    ok: false,
    errors: errors.map((e) => ({
      ...e,
      doc: e.doc ?? `wd explain ${e.code}`,
    })),
    ...(options.next && options.next.length > 0 ? { next: options.next } : {}),
    ...(options.warnings && options.warnings.length > 0 ? { warnings: options.warnings } : {}),
    meta: {
      ...(options.stage ? { stage: options.stage } : {}),
      wdVersion: options.wdVersion,
      durationMs: Math.max(0, Math.round(performance.now() - options.startedAt)),
      schemaVersion: "1",
    },
  };
}

/**
 * Convert a list of `Next: <cmd>` text suggestions (the legacy hypermedia
 * format) to structured `next` entries. Pairs with `printNextActions` so the
 * text-mode and JSON-mode hypermedia stay in sync.
 */
export function nextFromCommands(commands: Array<string | WdJsonNext>): WdJsonNext[] {
  return commands.map((entry) =>
    typeof entry === "string" ? { cmd: entry, why: "" } : entry,
  );
}
