export { defineConfig } from "./config.js";
export type {
  CfStageConfig,
  DevCompanionConfig,
  DevConfig,
  DevD1Config,
  DevEndpointConfig,
  DevSnapshotConfig,
  D1FixtureConfig,
  DevSessionConfig,
  FixtureConfig,
  LocalVerifyPackConfig,
  LocalVerifyCheckConfig,
  LocalVerifyConfig,
  QueueFixtureConfig,
  ResourceConfig,
  WorkerRef,
  WorkerFixtureConfig,
  StageRule,
  StateConfig,
  LifecycleStatus,
  ResourceProps,
  ResourceOutput,
  D1Output,
  KvOutput,
  QueueOutput,
  R2Output,
  HyperdriveOutput,
  VectorizeOutput,
} from "./types.js";
export { resourceId, resourceStagedName, isActive } from "./types.js";

// State providers
export { resolveStateProvider, loadState, LocalStateProvider, KvStateProvider } from "./core/state.js";
export type { StateProvider } from "./core/state.js";

// Typed resource system — phantom Env types
export { kv, queue, hyperdrive, d1, r2, vectorize, worker, workflow, secret, workerEnv } from "./typed.js";
export type {
  KvMarker,
  QueueMarker,
  HyperdriveMarker,
  D1Marker,
  R2Marker,
  VectorizeMarker,
  WorkerMarker,
  WorkflowMarker,
  SecretMarker,
  ResourceMarker,
  Bound,
  DeriveEnv,
} from "./typed.js";

// Enriched markers
export { enrichMarkers, loadStateOutputs } from "./core/enrich.js";

// Graph & Visibility
export { buildRichGraph, type RichGraph, type RichNode, type RichEdge, type RichNodeType, type RichEdgeType } from "./core/graph-model.js";
export { analyzeImpact, type ImpactResult, type UpstreamDep, type DownstreamDep } from "./core/impact.js";
export { diffStages, type StageDiffResult, type ResourceDiff, type WorkerDiff, type SecretDiff } from "./core/stage-diff.js";
export { renderAscii } from "./core/renderers/ascii.js";
export { renderMermaid } from "./core/renderers/mermaid.js";
export { renderDot } from "./core/renderers/dot.js";
export { renderJson } from "./core/renderers/json.js";

// Dev
export {
  buildDevPlan,
  startDev,
  type DevCompanionPlan,
  type DevHandle,
  type DevOptions,
  type DevPlan,
  type WorkerDevPlan,
  type WranglerSessionPlan,
} from "./core/dev.js";
export { assignPorts } from "./core/dev-ports.js";
export { createLogMultiplexer, logFilePathForTarget, type LogMultiplexer, type LogMultiplexerOptions } from "./core/dev-logs.js";
export { findAvailablePorts } from "./core/port-finder.js";
export {
  getQueueRoute,
  getD1Database,
  listD1Databases,
  listQueueRoutes,
  listWorkerRoutes,
  parseInterval,
  readDevLogSnapshot,
  readQueueTailSnapshot,
  resolveD1CommandTarget,
  replayQueueMessages,
  resolveWorkerCallTarget,
  resolveQueueSendTarget,
  resolvePlannedWorkerPort,
  runDevDoctor,
  executeLocalD1,
  callWorker,
  sendQueueMessage,
  triggerCron,
  type CronTriggerOptions,
  type CronTriggerResult,
  type D1CommandTarget,
  type D1DatabaseRoute,
  type D1ExecOptions,
  type D1ExecResult,
  type DevLogSnapshotOptions,
  type QueueReplayResult,
  type QueueSendOptions,
  type QueueSendResult,
  type QueueSendTarget,
  type QueueTailOptions,
  type QueueRoute,
  type WorkerCallOptions,
  type WorkerCallResult,
  type WorkerCallTarget,
  type WorkerRouteSummary,
} from "./core/runtime.js";
export { startDevUi, type DevUiHandle } from "./core/dev-ui.js";
export {
  clearActiveDevState,
  readActiveDevState,
  resolveDevLogDir,
  resolveDevStatePath,
  writeActiveDevState,
  type ActiveDevState,
} from "./core/dev-runtime-state.js";

// CI
export { detectCiEnvironment } from "./core/ci/detect.js";
export { createGitHubProvider } from "./core/ci/github.js";
export { buildPrComment } from "./core/ci/comment.js";
export { postCheckRun, type CheckResult } from "./core/ci/check.js";
export { generateGitHubWorkflow } from "./core/ci/workflow-gen.js";
export type { CiContext, CiProvider } from "./core/ci/types.js";

// Managed
export { writeManagedBindings, type ManagedEnvSection } from "./core/managed.js";
export { updateJsonc } from "./core/jsonc-writer.js";

// Diagnostics
export { runDoctor, type DoctorCheck, type DoctorDeps } from "./core/doctor.js";
export { validateConfig } from "./core/validate-config.js";
export { generateCompletions } from "./core/completions.js";
export { verify, verifyLocal, type VerifyArgs, type VerifyCheck, type VerifyDeps, type VerifyResult, type LocalVerifyDeps, type LocalVerifyResult } from "./core/verify.js";
export {
  getD1Fixture,
  getFixture,
  getQueueFixture,
  getWorkerFixture,
  listD1Fixtures,
  listFixtures,
  listQueueFixtures,
  listWorkerFixtures,
} from "./core/fixtures.js";
export {
  listSnapshots,
  loadSnapshot,
  resolveSnapshotPath,
  resolveSnapshotRoot,
  resolveSnapshotSources,
  saveSnapshot,
  type SnapshotSource,
  type SnapshotSummary,
} from "./core/snapshots.js";

// Timer
export { createTimer } from "./core/timer.js";
export { createViteStarter, type CreateStarterOptions, type CreateStarterResult } from "./core/create.js";
