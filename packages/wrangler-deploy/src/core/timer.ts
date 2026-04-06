export function createTimer(): { elapsed(): string } {
  const start = performance.now();
  return {
    elapsed(): string {
      const ms = performance.now() - start;
      if (ms < 1000) return `${Math.round(ms)}ms`;
      if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
      const mins = Math.floor(ms / 60_000);
      const secs = ((ms % 60_000) / 1000).toFixed(0);
      return `${mins}m${secs}s`;
    },
  };
}
