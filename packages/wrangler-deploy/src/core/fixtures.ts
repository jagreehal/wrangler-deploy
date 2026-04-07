import type {
  CfStageConfig,
  D1FixtureConfig,
  FixtureConfig,
  QueueFixtureConfig,
  WorkerFixtureConfig,
} from "../types.js";

export function listFixtures(config: CfStageConfig): Array<{ name: string; fixture: FixtureConfig }> {
  return Object.entries(config.fixtures ?? {}).map(([name, fixture]) => ({ name, fixture }));
}

export function getFixture(config: CfStageConfig, name: string): FixtureConfig | undefined {
  return config.fixtures?.[name];
}

export function getWorkerFixture(config: CfStageConfig, name: string): WorkerFixtureConfig | undefined {
  const fixture = getFixture(config, name);
  return fixture?.type === "worker" ? fixture : undefined;
}

export function getQueueFixture(config: CfStageConfig, name: string): QueueFixtureConfig | undefined {
  const fixture = getFixture(config, name);
  return fixture?.type === "queue" ? fixture : undefined;
}

export function getD1Fixture(config: CfStageConfig, name: string): D1FixtureConfig | undefined {
  const fixture = getFixture(config, name);
  return fixture?.type === "d1" ? fixture : undefined;
}

export function listWorkerFixtures(
  config: CfStageConfig,
  workerPath?: string,
): Array<{ name: string; fixture: WorkerFixtureConfig }> {
  return listFixtures(config)
    .filter((entry): entry is { name: string; fixture: WorkerFixtureConfig } => entry.fixture.type === "worker")
    .filter((entry) => !workerPath || entry.fixture.worker === workerPath);
}

export function listQueueFixtures(
  config: CfStageConfig,
  queue?: string,
): Array<{ name: string; fixture: QueueFixtureConfig }> {
  return listFixtures(config)
    .filter((entry): entry is { name: string; fixture: QueueFixtureConfig } => entry.fixture.type === "queue")
    .filter((entry) => !queue || entry.fixture.queue === queue);
}

export function listD1Fixtures(
  config: CfStageConfig,
  database?: string,
): Array<{ name: string; fixture: D1FixtureConfig }> {
  return listFixtures(config)
    .filter((entry): entry is { name: string; fixture: D1FixtureConfig } => entry.fixture.type === "d1")
    .filter((entry) => !database || entry.fixture.database === database);
}
