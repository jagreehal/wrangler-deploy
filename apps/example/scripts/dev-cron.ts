const POLL_INTERVAL_MS = 5_000;
const entryWorker = process.env.WD_DEV_ENTRY_WORKER ?? "unknown";
const entryUrl = process.env.WD_DEV_ENTRY_URL ?? "n/a";
const portMap = process.env.WD_DEV_PORTS ?? "{}";

function tick(): void {
  console.log(`[dev:cron] session entry=${entryWorker} url=${entryUrl}`);
  console.log(`[dev:cron] known ports=${portMap}`);
}

console.log(`[dev:cron] started, polling every ${POLL_INTERVAL_MS / 1000}s`);
tick();
setInterval(tick, POLL_INTERVAL_MS);
