import { describe, expect, it } from "vitest";
import { diffAccounts } from "./diff-config.js";

describe("diffAccounts", () => {
  it("detects added/removed accounts", () => {
    const d = diffAccounts(
      [{ accountId: "a", workers: [] }],
      [{ accountId: "b", workers: [] }],
    );
    expect(d.addedAccounts).toEqual(["b"]);
    expect(d.removedAccounts).toEqual(["a"]);
  });

  it("detects worker add/remove + threshold change", () => {
    const d = diffAccounts(
      [
        {
          accountId: "a",
          workers: [
            { scriptName: "api", thresholds: { requests: 100 } },
            { scriptName: "old", thresholds: {} },
          ],
        },
      ],
      [
        {
          accountId: "a",
          workers: [
            { scriptName: "api", thresholds: { requests: 200 } },
            { scriptName: "new", thresholds: {} },
          ],
        },
      ],
    );
    expect(d.workerChanges).toEqual([
      {
        accountId: "a",
        addedScripts: ["new"],
        removedScripts: ["old"],
        thresholdChanges: [{ scriptName: "api", before: { requests: 100 }, after: { requests: 200 } }],
      },
    ]);
  });

  it("returns empty diff for identical configs", () => {
    const cfg = [
      { accountId: "a", workers: [{ scriptName: "api", thresholds: { requests: 1 } }] },
    ];
    expect(diffAccounts(cfg, cfg)).toEqual({
      addedAccounts: [],
      removedAccounts: [],
      workerChanges: [],
    });
  });
});
