var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/config.ts
var config_exports = {};
__export(config_exports, {
  expandPresetsForWorker: () => expandPresetsForWorker,
  loadAccountConfig: () => loadAccountConfig,
  loadNotificationConfig: () => loadNotificationConfig
});
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function loadAccountConfig(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`ACCOUNTS_JSON is not valid JSON: ${e.message}`);
  }
  assert(Array.isArray(parsed), "ACCOUNTS_JSON must be an array");
  return parsed.map((a, i) => {
    assert(a && typeof a === "object", `ACCOUNTS_JSON[${i}] must be an object`);
    const acc = a;
    assert(typeof acc.accountId === "string", `ACCOUNTS_JSON[${i}].accountId must be a string`);
    assert(Array.isArray(acc.workers), `ACCOUNTS_JSON[${i}].workers must be an array`);
    assert(typeof acc.billingCycleDay === "number", `ACCOUNTS_JSON[${i}].billingCycleDay must be a number`);
    assert(Array.isArray(acc.globalProtected), `ACCOUNTS_JSON[${i}].globalProtected must be an array`);
    const workers = acc.workers.map((w, j) => {
      assert(w && typeof w === "object", `workers[${j}] must be an object`);
      const ww = w;
      assert(typeof ww.scriptName === "string", `workers[${j}].scriptName must be a string`);
      return ww;
    });
    return {
      accountId: acc.accountId,
      billingCycleDay: acc.billingCycleDay,
      workers,
      globalProtected: acc.globalProtected
    };
  });
}
function loadNotificationConfig(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`NOTIFICATIONS_JSON is not valid JSON: ${e.message}`);
  }
  assert(parsed && typeof parsed === "object", "NOTIFICATIONS_JSON must be an object");
  const obj = parsed;
  assert(Array.isArray(obj.channels), "NOTIFICATIONS_JSON.channels must be an array");
  const channels = obj.channels;
  const names = /* @__PURE__ */ new Set();
  for (const c of channels) {
    assert(typeof c.name === "string" && c.name.length > 0, "channel.name must be a non-empty string");
    assert(!names.has(c.name), `duplicate channel name: ${c.name}`);
    names.add(c.name);
  }
  const dedupWindowSeconds = typeof obj.dedupWindowSeconds === "number" ? obj.dedupWindowSeconds : 86400;
  return { channels, dedupWindowSeconds };
}
function expandPresetsForWorker(worker, ctx) {
  const rules = [];
  const t = worker.thresholds ?? {};
  for (const p of worker.presets ?? []) {
    if (p === "cost-runaway") {
      rules.push({
        ruleId: "cost-runaway",
        costUsd: t.costUsd ?? ctx.rolling.avgDailyCostUsd * 2
      });
    } else if (p === "request-flood") {
      rules.push({ ruleId: "request-flood", requests: t.requests ?? ctx.defaults.requests });
    } else if (p === "cpu-spike") {
      rules.push({ ruleId: "cpu-spike", cpuMs: t.cpuMs ?? ctx.defaults.cpuMs });
    }
  }
  if (rules.length === 0 && (t.requests || t.cpuMs || t.costUsd)) {
    rules.push({ ruleId: "custom", requests: t.requests, cpuMs: t.cpuMs, costUsd: t.costUsd });
  }
  return rules;
}
var init_config = __esm({
  "src/config.ts"() {
    "use strict";
    __name(assert, "assert");
    __name(loadAccountConfig, "loadAccountConfig");
    __name(loadNotificationConfig, "loadNotificationConfig");
    __name(expandPresetsForWorker, "expandPresetsForWorker");
  }
});

// src/thresholds/evaluate.ts
function detectBreaches(args) {
  const breaches = [];
  for (const r of args.rules) {
    if (r.requests !== void 0 && args.usage.requests >= r.requests) {
      breaches.push({ ruleId: r.ruleId, breachType: "requests", limit: r.requests, actual: args.usage.requests });
    }
    if (r.cpuMs !== void 0 && args.usage.cpuMs >= r.cpuMs) {
      breaches.push({ ruleId: r.ruleId, breachType: "cpu_ms", limit: r.cpuMs, actual: args.usage.cpuMs });
    }
    if (r.costUsd !== void 0 && args.usage.estimatedCostUsd >= r.costUsd) {
      breaches.push({ ruleId: r.ruleId, breachType: "cost", limit: r.costUsd, actual: args.usage.estimatedCostUsd });
    }
  }
  return breaches;
}
var init_evaluate = __esm({
  "src/thresholds/evaluate.ts"() {
    "use strict";
    __name(detectBreaches, "detectBreaches");
  }
});

// src/thresholds/forecast.ts
function projectBreaches(args) {
  if (!args.forecastEnabled) return [];
  const elapsedSec = (args.now.getTime() - args.periodStart.getTime()) / 1e3;
  if (elapsedSec <= 0) return [];
  const multiplier = (elapsedSec + args.lookaheadSeconds) / elapsedSec;
  const projected = {
    requests: args.usage.requests * multiplier,
    cpuMs: args.usage.cpuMs * multiplier,
    estimatedCostUsd: args.usage.estimatedCostUsd * multiplier
  };
  const breaches = [];
  for (const r of args.rules) {
    const tag = `forecast:${r.ruleId}`;
    if (r.requests !== void 0 && args.usage.requests < r.requests && projected.requests >= r.requests) {
      breaches.push({
        ruleId: tag,
        breachType: "requests",
        limit: r.requests,
        actual: Math.round(projected.requests)
      });
    }
    if (r.cpuMs !== void 0 && args.usage.cpuMs < r.cpuMs && projected.cpuMs >= r.cpuMs) {
      breaches.push({
        ruleId: tag,
        breachType: "cpu_ms",
        limit: r.cpuMs,
        actual: Math.round(projected.cpuMs)
      });
    }
    if (r.costUsd !== void 0 && args.usage.estimatedCostUsd < r.costUsd && projected.estimatedCostUsd >= r.costUsd) {
      breaches.push({
        ruleId: tag,
        breachType: "cost",
        limit: r.costUsd,
        actual: Math.round(projected.estimatedCostUsd * 100) / 100
      });
    }
  }
  return breaches;
}
var init_forecast = __esm({
  "src/thresholds/forecast.ts"() {
    "use strict";
    __name(projectBreaches, "projectBreaches");
  }
});

// src/cooldown.ts
function shouldSuppress(args) {
  if (!args.row) return { suppressed: false };
  const nowIso = args.now.toISOString();
  if (args.row.graceUntil && args.row.graceUntil > nowIso) {
    return { suppressed: true, reason: "grace", until: args.row.graceUntil };
  }
  if (args.row.cooldownUntil > nowIso) {
    return { suppressed: true, reason: "cooldown", until: args.row.cooldownUntil };
  }
  return { suppressed: false };
}
var init_cooldown = __esm({
  "src/cooldown.ts"() {
    "use strict";
    __name(shouldSuppress, "shouldSuppress");
  }
});

// src/cost.ts
function estimateWorkersCost(args) {
  const extraReq = Math.max(0, args.requests - INCLUDED_REQUESTS);
  const extraCpu = Math.max(0, args.cpuMs - INCLUDED_CPU_MS);
  const requestsCost = extraReq / 1e6 * COST_PER_M_REQUESTS;
  const cpuCost = extraCpu / 1e6 * COST_PER_M_CPU_MS;
  return { requestsCost, cpuCost, total: requestsCost + cpuCost };
}
var INCLUDED_REQUESTS, INCLUDED_CPU_MS, COST_PER_M_REQUESTS, COST_PER_M_CPU_MS;
var init_cost = __esm({
  "src/cost.ts"() {
    "use strict";
    INCLUDED_REQUESTS = 1e7;
    INCLUDED_CPU_MS = 3e7;
    COST_PER_M_REQUESTS = 0.3;
    COST_PER_M_CPU_MS = 0.02;
    __name(estimateWorkersCost, "estimateWorkersCost");
  }
});

// src/scan/overage-check.ts
function computeBillingPeriod(now, billingCycleDay) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), billingCycleDay, 0, 0, 0));
  if (start.getTime() > now.getTime()) {
    start.setUTCMonth(start.getUTCMonth() - 1);
  }
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  end.setUTCSeconds(end.getUTCSeconds() - 1);
  return { start: start.toISOString(), end: end.toISOString() };
}
async function runOverageCheck(args, deps) {
  const now = deps.now();
  const runtimeProtected = await deps.loadRuntimeProtectedSet();
  for (const account of args.accounts) {
    const period = computeBillingPeriod(now, account.billingCycleDay);
    const scriptNames = account.workers.map((w) => w.scriptName);
    if (scriptNames.length === 0) continue;
    const { rows } = await deps.fetchUsage({
      accountId: account.accountId,
      periodStart: period.start,
      periodEnd: period.end,
      scriptNames
    });
    for (const worker of account.workers) {
      const row = rows.find((r) => r.scriptName === worker.scriptName);
      const usage = {
        requests: row?.requests ?? 0,
        cpuMs: row?.cpuMs ?? 0,
        estimatedCostUsd: estimateWorkersCost({ requests: row?.requests ?? 0, cpuMs: row?.cpuMs ?? 0 }).total
      };
      await deps.insertSnapshot({
        snapshot: {
          id: deps.id(),
          accountId: account.accountId,
          scriptName: worker.scriptName,
          capturedAt: now.toISOString(),
          requests: usage.requests,
          cpuMs: usage.cpuMs,
          estimatedCostUsd: usage.estimatedCostUsd,
          periodStart: period.start,
          periodEnd: period.end
        }
      });
      if (deps.isProtected({ scriptName: worker.scriptName, guardScriptName: deps.guardScriptName, account, runtimeProtected })) {
        await deps.appendActivity({
          event: {
            id: deps.id(),
            createdAt: now.toISOString(),
            actor: "cron:5min",
            action: "protected_skipped",
            resourceType: "worker",
            resourceId: worker.scriptName,
            details: null
          }
        });
        continue;
      }
      const rules = expandPresetsForWorker(worker, {
        defaults: { requests: args.defaults.requests, cpuMs: args.defaults.cpuMs },
        rolling: { avgDailyCostUsd: 0 }
      });
      if (rules.length === 0 && worker.thresholds) {
        rules.push({ ruleId: "custom", ...worker.thresholds });
      }
      const detected = detectBreaches({ usage, rules });
      const forecasted = projectBreaches({
        usage,
        rules,
        now,
        periodStart: new Date(period.start),
        forecastEnabled: worker.forecast === true,
        lookaheadSeconds: worker.forecastLookaheadSeconds ?? 600
      });
      const breaches = [...detected, ...forecasted];
      for (const b of breaches) {
        const breachKey = `${account.accountId}:${worker.scriptName}:${b.breachType}`;
        const state = await deps.getState({ breachKey });
        const suppress = shouldSuppress({ row: state, now });
        if (suppress.suppressed) {
          await deps.appendActivity({
            event: {
              id: deps.id(),
              createdAt: now.toISOString(),
              actor: "cron:5min",
              action: "breach_suppressed",
              resourceType: "worker",
              resourceId: worker.scriptName,
              details: { reason: suppress.reason, until: suppress.until, breachType: b.breachType }
            }
          });
          continue;
        }
        const cooldownSeconds = worker.cooldownSeconds ?? args.cooldownSeconds;
        await deps.upsertOnBreach({
          accountId: account.accountId,
          scriptName: worker.scriptName,
          breachType: b.breachType,
          cooldownSeconds,
          now
        });
        const wf = await deps.createWorkflow({
          id: `${breachKey}:${period.end.slice(0, 10)}`,
          params: {
            accountId: account.accountId,
            scriptName: worker.scriptName,
            breachType: b.breachType,
            ruleId: b.ruleId,
            actual: b.actual,
            limit: b.limit,
            breachKey,
            periodStart: period.start,
            periodEnd: period.end,
            zones: worker.zones ?? []
          }
        });
        await deps.setWorkflowInstanceId({ breachKey, workflowInstanceId: wf.id });
        await deps.appendActivity({
          event: {
            id: deps.id(),
            createdAt: now.toISOString(),
            actor: "cron:5min",
            action: "breach_detected",
            resourceType: "worker",
            resourceId: worker.scriptName,
            details: {
              ruleId: b.ruleId,
              breachType: b.breachType,
              actual: b.actual,
              limit: b.limit,
              workflowInstanceId: wf.id
            }
          }
        });
      }
    }
  }
}
var init_overage_check = __esm({
  "src/scan/overage-check.ts"() {
    "use strict";
    init_config();
    init_evaluate();
    init_forecast();
    init_cooldown();
    init_cost();
    __name(computeBillingPeriod, "computeBillingPeriod");
    __name(runOverageCheck, "runOverageCheck");
  }
});

// src/report/daily.ts
function billingPeriod(now, cycleDay) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), cycleDay));
  if (start.getTime() > now.getTime()) start.setUTCMonth(start.getUTCMonth() - 1);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  end.setUTCSeconds(end.getUTCSeconds() - 1);
  return { start: start.toISOString(), end: end.toISOString() };
}
async function runDailyReport(args, deps) {
  const now = deps.now();
  for (const account of args.accounts) {
    const period = billingPeriod(now, account.billingCycleDay);
    const { rows } = await deps.fetchUsage({
      accountId: account.accountId,
      periodStart: period.start,
      periodEnd: period.end,
      scriptNames: account.workers.map((w) => w.scriptName)
    });
    const perWorker = rows.map((r) => {
      const cost = estimateWorkersCost({ requests: r.requests, cpuMs: r.cpuMs }).total;
      return { scriptName: r.scriptName, requests: r.requests, cpuMs: r.cpuMs, estimatedCostUsd: cost };
    }).sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd);
    const totals = perWorker.reduce(
      (acc, w) => ({
        requests: acc.requests + w.requests,
        cpuMs: acc.cpuMs + w.cpuMs,
        estimatedCostUsd: acc.estimatedCostUsd + w.estimatedCostUsd
      }),
      { requests: 0, cpuMs: 0, estimatedCostUsd: 0 }
    );
    const report = {
      id: deps.id(),
      accountId: account.accountId,
      billingPeriodStart: period.start,
      billingPeriodEnd: period.end,
      generatedAt: now.toISOString(),
      payload: { perWorker, totals, savingsThisMonthUsd: 0 }
    };
    await deps.insertReport({ report });
    await deps.dispatch({ report });
  }
}
var init_daily = __esm({
  "src/report/daily.ts"() {
    "use strict";
    init_cost();
    __name(billingPeriod, "billingPeriod");
    __name(runDailyReport, "runDailyReport");
  }
});

// ../usage-guard-shared/dist/types.js
var init_types = __esm({
  "../usage-guard-shared/dist/types.js"() {
    "use strict";
  }
});

// ../usage-guard-shared/dist/graphql.js
async function gql(args, deps) {
  const res = await deps.fetch(GQL_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${deps.token}` },
    body: JSON.stringify({ query: args.query, variables: args.variables })
  });
  if (!res.ok)
    throw new Error(`GraphQL HTTP ${res.status}: ${await res.text().catch(() => "")}`);
  const json2 = await res.json();
  if (json2.errors?.length)
    throw new Error(`GraphQL errors: ${JSON.stringify(json2.errors)}`);
  if (!json2.data)
    throw new Error("GraphQL response missing data");
  return json2.data;
}
async function fetchWorkerUsage(args, deps) {
  const raw = await gql({
    query: QUERY_WORKERS_USAGE,
    variables: {
      accountTag: args.accountId,
      datetimeStart: args.periodStart,
      datetimeEnd: args.periodEnd,
      scriptNames: args.scriptNames
    }
  }, deps);
  const rows = raw.viewer.accounts[0]?.workersInvocationsAdaptive.map((x) => ({
    scriptName: x.dimensions.scriptName,
    requests: x.sum.requests,
    cpuMs: Math.round(x.sum.cpuTime / 1e3)
  })) ?? [];
  return { raw, rows };
}
var GQL_URL, QUERY_WORKERS_USAGE;
var init_graphql = __esm({
  "../usage-guard-shared/dist/graphql.js"() {
    "use strict";
    GQL_URL = "https://api.cloudflare.com/client/v4/graphql";
    __name(gql, "gql");
    QUERY_WORKERS_USAGE = /* GraphQL */
    `
  query WorkersUsage($accountTag: String!, $datetimeStart: Time!, $datetimeEnd: Time!, $scriptNames: [String!]!) {
    viewer {
      accounts(filter: { accountTag: $accountTag }) {
        workersInvocationsAdaptive(
          filter: {
            datetime_geq: $datetimeStart
            datetime_leq: $datetimeEnd
            scriptName_in: $scriptNames
          }
          limit: 10000
        ) {
          dimensions { scriptName }
          sum { requests cpuTime }
        }
      }
    }
  }
`;
    __name(fetchWorkerUsage, "fetchWorkerUsage");
  }
});

// ../usage-guard-shared/dist/signing.js
async function hmac(key, data) {
  const cryptoKey = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function signRequest(args) {
  return hmac(args.key, `${args.method.toUpperCase()}
${args.path}
${args.timestamp}`);
}
async function verifyRequest(args) {
  const ts = Date.parse(args.timestamp);
  if (Number.isNaN(ts))
    return false;
  if (Math.abs(args.now.getTime() - ts) > args.maxSkewSeconds * 1e3)
    return false;
  const expected = await signRequest(args);
  if (expected.length !== args.signature.length)
    return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++)
    diff |= expected.charCodeAt(i) ^ args.signature.charCodeAt(i);
  return diff === 0;
}
var enc;
var init_signing = __esm({
  "../usage-guard-shared/dist/signing.js"() {
    "use strict";
    enc = new TextEncoder();
    __name(hmac, "hmac");
    __name(signRequest, "signRequest");
    __name(verifyRequest, "verifyRequest");
  }
});

// ../usage-guard-shared/dist/index.js
var init_dist = __esm({
  "../usage-guard-shared/dist/index.js"() {
    "use strict";
    init_types();
    init_graphql();
    init_signing();
  }
});

// src/http/signing.ts
var init_signing2 = __esm({
  "src/http/signing.ts"() {
    "use strict";
    init_dist();
  }
});

// src/http/api.ts
function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}
async function requireSigned(req, deps, path) {
  const ts = req.headers.get("x-guard-timestamp");
  const sig = req.headers.get("x-guard-signature");
  if (!ts || !sig) return json(401, { error: "missing signature" });
  const ok2 = await verifyRequest({
    method: req.method,
    path,
    timestamp: ts,
    signature: sig,
    key: deps.signingKey,
    now: deps.now(),
    maxSkewSeconds: 300
  });
  return ok2 ? null : json(401, { error: "bad signature" });
}
async function handleApiRequest(args, deps) {
  const url = new URL(args.request.url);
  const path = url.pathname + url.search;
  const route = url.pathname;
  if (route === "/api/health") {
    const info = await deps.healthInfo();
    return json(200, { ok: true, ...info });
  }
  const denied = await requireSigned(args.request, deps, path);
  if (denied) return denied;
  if (args.request.method === "POST") {
    if (route === "/api/disarm") {
      let body;
      try {
        body = await args.request.json();
      } catch {
        return json(400, { error: "invalid JSON body" });
      }
      if (!body.accountId || !body.scriptName) {
        return json(400, { error: "accountId and scriptName are required" });
      }
      await deps.addRuntimeProtection({
        accountId: body.accountId,
        scriptName: body.scriptName,
        addedBy: body.addedBy ?? "cli:unknown",
        ...body.reason ? { reason: body.reason } : {}
      });
      return json(200, { ok: true });
    }
    const approveMatch = route.match(/^\/api\/approvals\/([^/]+)\/(approve|reject)$/);
    if (approveMatch) {
      const [, approvalId, action] = approveMatch;
      let body;
      try {
        body = await args.request.json();
      } catch {
        return json(400, { error: "invalid JSON body" });
      }
      if (!body.accountId) {
        return json(400, { error: "accountId is required" });
      }
      await deps.decideApproval({
        id: approvalId,
        accountId: body.accountId,
        decision: action === "approve" ? "approved" : "rejected",
        decidedBy: body.decidedBy ?? "cli:unknown"
      });
      return json(200, { ok: true });
    }
    return json(404, { error: "not found" });
  }
  if (args.request.method === "DELETE") {
    if (route === "/api/disarm") {
      let body;
      try {
        body = await args.request.json();
      } catch {
        return json(400, { error: "invalid JSON body" });
      }
      if (!body.accountId || !body.scriptName) {
        return json(400, { error: "accountId and scriptName are required" });
      }
      await deps.removeRuntimeProtection({
        accountId: body.accountId,
        scriptName: body.scriptName
      });
      return json(200, { ok: true });
    }
    return json(404, { error: "not found" });
  }
  const accountId = url.searchParams.get("account");
  if (!accountId) return json(400, { error: "missing account" });
  if (route === "/api/reports") {
    const reports = await deps.listReports({
      accountId,
      from: url.searchParams.get("from") ?? void 0,
      to: url.searchParams.get("to") ?? void 0
    });
    return json(200, { reports });
  }
  if (route === "/api/breaches") {
    const limit = Number(url.searchParams.get("limit") ?? "20");
    const breaches = await deps.listBreaches({ accountId, limit });
    return json(200, { breaches });
  }
  if (route === "/api/snapshots") {
    const scriptName = url.searchParams.get("script");
    if (!scriptName) return json(400, { error: "missing script" });
    const window = url.searchParams.get("window") ?? "7d";
    const snapshots = await deps.listSnapshots({ accountId, scriptName, window });
    return json(200, { snapshots });
  }
  if (route === "/api/runtime-protected") {
    const items = await deps.listRuntimeProtectedOn({ accountId });
    return json(200, { items });
  }
  if (route === "/api/approvals") {
    const items = await deps.listPendingApprovals({ accountId });
    return json(200, { items });
  }
  return json(404, { error: "not found" });
}
var init_api = __esm({
  "src/http/api.ts"() {
    "use strict";
    init_signing2();
    __name(json, "json");
    __name(requireSigned, "requireSigned");
    __name(handleApiRequest, "handleApiRequest");
  }
});

// src/graphql/queries.ts
var init_queries = __esm({
  "src/graphql/queries.ts"() {
    "use strict";
    init_dist();
  }
});

// src/cloudflare/protected.ts
function isProtected(args) {
  if (args.scriptName === args.guardScriptName) return true;
  if (args.runtimeProtected?.has(`${args.account.accountId}:${args.scriptName}`)) return true;
  if (args.account.globalProtected.includes(args.scriptName)) return true;
  const w = args.account.workers.find((x) => x.scriptName === args.scriptName);
  return w?.protected === true;
}
var init_protected = __esm({
  "src/cloudflare/protected.ts"() {
    "use strict";
    __name(isProtected, "isProtected");
  }
});

// src/db/runtime-protected.ts
async function addRuntimeProtection(args, deps) {
  const now = (args.now ?? /* @__PURE__ */ new Date()).toISOString();
  await deps.db.prepare(
    `INSERT INTO runtime_protected (account_id, script_name, added_at, added_by, reason)
       VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(account_id, script_name) DO UPDATE SET
         added_at = excluded.added_at,
         added_by = excluded.added_by,
         reason = excluded.reason`
  ).bind(
    args.accountId,
    args.scriptName,
    now,
    args.addedBy,
    args.reason ?? null
  ).run();
}
async function removeRuntimeProtection(args, deps) {
  await deps.db.prepare("DELETE FROM runtime_protected WHERE account_id = ?1 AND script_name = ?2").bind(args.accountId, args.scriptName).run();
}
async function listRuntimeProtected(args, deps) {
  const { results } = await deps.db.prepare(
    `SELECT account_id, script_name, added_at, added_by, reason
         FROM runtime_protected
        WHERE account_id = ?1
        ORDER BY added_at DESC`
  ).bind(args.accountId).all();
  return results.map((r) => ({
    accountId: r.account_id,
    scriptName: r.script_name,
    addedAt: r.added_at,
    addedBy: r.added_by,
    reason: r.reason
  }));
}
async function loadRuntimeProtectedSet(deps) {
  const { results } = await deps.db.prepare("SELECT account_id, script_name FROM runtime_protected").all();
  const set = /* @__PURE__ */ new Set();
  for (const r of results) set.add(`${r.account_id}:${r.script_name}`);
  return set;
}
var init_runtime_protected = __esm({
  "src/db/runtime-protected.ts"() {
    "use strict";
    __name(addRuntimeProtection, "addRuntimeProtection");
    __name(removeRuntimeProtection, "removeRuntimeProtection");
    __name(listRuntimeProtected, "listRuntimeProtected");
    __name(loadRuntimeProtectedSet, "loadRuntimeProtectedSet");
  }
});

// src/db/approvals.ts
var approvals_exports = {};
__export(approvals_exports, {
  createApproval: () => createApproval,
  decideApproval: () => decideApproval,
  expireStaleApprovals: () => expireStaleApprovals,
  getApproval: () => getApproval,
  listPendingApprovals: () => listPendingApprovals
});
function fromDb(r) {
  return {
    id: r.id,
    accountId: r.account_id,
    scriptName: r.script_name,
    breachKey: r.breach_key,
    workflowInstanceId: r.workflow_instance_id,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    status: r.status,
    decidedAt: r.decided_at,
    decidedBy: r.decided_by,
    ruleId: r.rule_id,
    breachType: r.breach_type,
    actualValue: r.actual_value,
    limitValue: r.limit_value
  };
}
async function createApproval(args, deps) {
  const id = args.id ?? crypto.randomUUID();
  const now = args.now ?? /* @__PURE__ */ new Date();
  const expiresAt = new Date(now.getTime() + args.expiresInSeconds * 1e3).toISOString();
  await deps.db.prepare(
    `INSERT INTO pending_approvals (
      id, account_id, script_name, breach_key, workflow_instance_id,
      created_at, expires_at, status, rule_id, breach_type, actual_value, limit_value
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending', ?8, ?9, ?10, ?11)`
  ).bind(
    id,
    args.accountId,
    args.scriptName,
    args.breachKey,
    args.workflowInstanceId,
    now.toISOString(),
    expiresAt,
    args.ruleId,
    args.breachType,
    args.actualValue,
    args.limitValue
  ).run();
  return id;
}
async function getApproval(args, deps) {
  const row = await deps.db.prepare("SELECT * FROM pending_approvals WHERE id = ?1").bind(args.id).first();
  return row ? fromDb(row) : null;
}
async function listPendingApprovals(args, deps) {
  const { results } = await deps.db.prepare(
    "SELECT * FROM pending_approvals WHERE account_id = ?1 AND status = 'pending' ORDER BY created_at DESC"
  ).bind(args.accountId).all();
  return results.map(fromDb);
}
async function decideApproval(args, deps) {
  const now = args.now ?? /* @__PURE__ */ new Date();
  await deps.db.prepare(
    "UPDATE pending_approvals SET status = ?1, decided_at = ?2, decided_by = ?3 WHERE id = ?4 AND account_id = ?5 AND status = 'pending'"
  ).bind(args.decision, now.toISOString(), args.decidedBy, args.id, args.accountId).run();
}
async function expireStaleApprovals(args, deps) {
  const now = args.now ?? /* @__PURE__ */ new Date();
  const result = await deps.db.prepare(
    "UPDATE pending_approvals SET status = 'expired' WHERE status = 'pending' AND expires_at < ?1"
  ).bind(now.toISOString()).run();
  return result.meta?.changes ?? 0;
}
var init_approvals = __esm({
  "src/db/approvals.ts"() {
    "use strict";
    __name(fromDb, "fromDb");
    __name(createApproval, "createApproval");
    __name(getApproval, "getApproval");
    __name(listPendingApprovals, "listPendingApprovals");
    __name(decideApproval, "decideApproval");
    __name(expireStaleApprovals, "expireStaleApprovals");
  }
});

// src/db/state.ts
function fromRow(r) {
  return {
    breachKey: r.breach_key,
    accountId: r.account_id,
    scriptName: r.script_name,
    breachType: r.breach_type,
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
    cooldownUntil: r.cooldown_until,
    graceUntil: r.grace_until,
    workflowInstanceId: r.workflow_instance_id
  };
}
async function getOverageState(args, deps) {
  const row = await deps.db.prepare("SELECT * FROM overage_state WHERE breach_key = ?1").bind(args.breachKey).first();
  return row ? fromRow(row) : null;
}
async function upsertOverageStateOnBreach(args, deps) {
  const now = args.now ?? /* @__PURE__ */ new Date();
  const breachKey = `${args.accountId}:${args.scriptName}:${args.breachType}`;
  const nowIso = now.toISOString();
  const cooldownUntil = new Date(now.getTime() + args.cooldownSeconds * 1e3).toISOString();
  await deps.db.prepare(
    `INSERT INTO overage_state (
         breach_key, account_id, script_name, breach_type,
         first_seen_at, last_seen_at, cooldown_until
       ) VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6)
       ON CONFLICT(breach_key) DO UPDATE SET
         last_seen_at = excluded.last_seen_at,
         cooldown_until = excluded.cooldown_until`
  ).bind(breachKey, args.accountId, args.scriptName, args.breachType, nowIso, cooldownUntil).run();
  return breachKey;
}
async function setGraceUntil(args, deps) {
  await deps.db.prepare("UPDATE overage_state SET grace_until = ?1 WHERE breach_key = ?2").bind(args.graceUntil, args.breachKey).run();
}
async function setWorkflowInstanceId(args, deps) {
  await deps.db.prepare("UPDATE overage_state SET workflow_instance_id = ?1 WHERE breach_key = ?2").bind(args.workflowInstanceId, args.breachKey).run();
}
var init_state = __esm({
  "src/db/state.ts"() {
    "use strict";
    __name(fromRow, "fromRow");
    __name(getOverageState, "getOverageState");
    __name(upsertOverageStateOnBreach, "upsertOverageStateOnBreach");
    __name(setGraceUntil, "setGraceUntil");
    __name(setWorkflowInstanceId, "setWorkflowInstanceId");
  }
});

// src/db/snapshots.ts
async function insertUsageSnapshot(args, deps) {
  const s = args.snapshot;
  await deps.db.prepare(
    `INSERT INTO usage_snapshots
         (id, account_id, script_name, captured_at, requests, cpu_ms, estimated_cost_usd, period_start, period_end)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
  ).bind(
    s.id,
    s.accountId,
    s.scriptName,
    s.capturedAt,
    s.requests,
    s.cpuMs,
    s.estimatedCostUsd,
    s.periodStart,
    s.periodEnd
  ).run();
}
async function listRecentSnapshots(args, deps) {
  const { results } = await deps.db.prepare(
    `SELECT id, account_id, script_name, captured_at, requests, cpu_ms,
              estimated_cost_usd, period_start, period_end
         FROM usage_snapshots
        WHERE account_id = ?1 AND script_name = ?2
        ORDER BY captured_at DESC
        LIMIT ?3`
  ).bind(args.accountId, args.scriptName, args.limit).all();
  return results.map((r) => ({
    id: r.id,
    accountId: r.account_id,
    scriptName: r.script_name,
    capturedAt: r.captured_at,
    requests: r.requests,
    cpuMs: r.cpu_ms,
    estimatedCostUsd: r.estimated_cost_usd,
    periodStart: r.period_start,
    periodEnd: r.period_end
  }));
}
var init_snapshots = __esm({
  "src/db/snapshots.ts"() {
    "use strict";
    __name(insertUsageSnapshot, "insertUsageSnapshot");
    __name(listRecentSnapshots, "listRecentSnapshots");
  }
});

// src/db/activity.ts
var activity_exports = {};
__export(activity_exports, {
  appendActivity: () => appendActivity,
  makeLogger: () => makeLogger
});
async function appendActivity(args, deps) {
  const e = args.event;
  await deps.db.prepare(
    `INSERT INTO activity_log
         (id, created_at, actor, action, resource_type, resource_id, details_json)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`
  ).bind(e.id, e.createdAt, e.actor, e.action, e.resourceType, e.resourceId, e.details ? JSON.stringify(e.details) : null).run();
}
function makeLogger(args, deps) {
  const now = args.nowFn ?? (() => /* @__PURE__ */ new Date());
  const id = args.idFn ?? (() => crypto.randomUUID());
  return async (entry) => {
    await appendActivity(
      {
        event: {
          id: id(),
          createdAt: now().toISOString(),
          actor: args.actor,
          ...entry
        }
      },
      deps
    );
  };
}
var init_activity = __esm({
  "src/db/activity.ts"() {
    "use strict";
    __name(appendActivity, "appendActivity");
    __name(makeLogger, "makeLogger");
  }
});

// src/db/reports.ts
async function insertUsageReport(args, deps) {
  const r = args.report;
  await deps.db.prepare(
    `INSERT INTO usage_reports
        (id, account_id, billing_period_start, billing_period_end, generated_at, payload_json)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
  ).bind(r.id, r.accountId, r.billingPeriodStart, r.billingPeriodEnd, r.generatedAt, JSON.stringify(r.payload)).run();
}
async function listRecentReports(args, deps) {
  const { results } = await deps.db.prepare(
    `SELECT id, account_id, billing_period_start, billing_period_end, generated_at, payload_json
         FROM usage_reports
        WHERE account_id = ?1
        ORDER BY generated_at DESC
        LIMIT ?2`
  ).bind(args.accountId, args.limit).all();
  return results.map((r) => ({
    id: r.id,
    accountId: r.account_id,
    billingPeriodStart: r.billing_period_start,
    billingPeriodEnd: r.billing_period_end,
    generatedAt: r.generated_at,
    payload: JSON.parse(r.payload_json)
  }));
}
var init_reports = __esm({
  "src/db/reports.ts"() {
    "use strict";
    __name(insertUsageReport, "insertUsageReport");
    __name(listRecentReports, "listRecentReports");
  }
});

// src/db/forensics.ts
async function insertBreachForensic(args, deps) {
  const f = args.forensic;
  await deps.db.prepare(
    `INSERT INTO breach_forensics
        (id, breach_key, workflow_instance_id, triggered_at, rule_id, graphql_response_json)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
  ).bind(f.id, f.breachKey, f.workflowInstanceId, f.triggeredAt, f.ruleId, JSON.stringify(f.graphqlResponse)).run();
}
async function completeBreachForensic(args, deps) {
  await deps.db.prepare(
    "UPDATE breach_forensics SET actions_taken_json = ?1, estimated_savings_usd = ?2 WHERE id = ?3"
  ).bind(JSON.stringify(args.actions), args.estimatedSavingsUsd, args.id).run();
}
async function listRecentBreaches(args, deps) {
  const { results } = await deps.db.prepare(
    `SELECT bf.* FROM breach_forensics bf
         JOIN overage_state os ON os.breach_key = bf.breach_key
         WHERE os.account_id = ?1
         ORDER BY bf.triggered_at DESC
         LIMIT ?2`
  ).bind(args.accountId, args.limit).all();
  return results.map((r) => ({
    id: r.id,
    breachKey: r.breach_key,
    workflowInstanceId: r.workflow_instance_id,
    triggeredAt: r.triggered_at,
    ruleId: r.rule_id,
    graphqlResponse: JSON.parse(r.graphql_response_json),
    actionsTaken: r.actions_taken_json ? JSON.parse(r.actions_taken_json) : null,
    estimatedSavingsUsd: r.estimated_savings_usd
  }));
}
var init_forensics = __esm({
  "src/db/forensics.ts"() {
    "use strict";
    __name(insertBreachForensic, "insertBreachForensic");
    __name(completeBreachForensic, "completeBreachForensic");
    __name(listRecentBreaches, "listRecentBreaches");
  }
});

// src/notify/types.ts
function err(channel, code, message) {
  return { ok: false, channel, error: { code, message } };
}
function ok(channel, dedupKey, sentAt) {
  return { ok: true, channel, sentAt, dedupKey };
}
async function postWithTimeout(args, deps) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), args.timeoutMs ?? 1e4);
  try {
    const res = await deps.fetch(args.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...args.headers ?? {} },
      body: args.body,
      signal: controller.signal
    });
    return { status: res.status, bodyText: await res.text().catch(() => "") };
  } finally {
    clearTimeout(t);
  }
}
var init_types2 = __esm({
  "src/notify/types.ts"() {
    "use strict";
    __name(err, "err");
    __name(ok, "ok");
    __name(postWithTimeout, "postWithTimeout");
  }
});

// src/db/dedupe.ts
async function isDeduped(args, deps) {
  const now = args.now ?? /* @__PURE__ */ new Date();
  const cutoff = new Date(now.getTime() - args.windowSeconds * 1e3).toISOString();
  const row = await deps.db.prepare(
    "SELECT sent_at FROM notification_dedupe WHERE dedup_key = ?1 AND channel_name = ?2 AND sent_at >= ?3"
  ).bind(args.dedupKey, args.channelName, cutoff).first();
  return row !== null;
}
async function recordDedupe(args, deps) {
  const now = args.now ?? /* @__PURE__ */ new Date();
  await deps.db.prepare(
    `INSERT INTO notification_dedupe (dedup_key, channel_name, sent_at)
       VALUES (?1, ?2, ?3)
       ON CONFLICT(dedup_key, channel_name) DO UPDATE SET sent_at = excluded.sent_at`
  ).bind(args.dedupKey, args.channelName, now.toISOString()).run();
}
var init_dedupe = __esm({
  "src/db/dedupe.ts"() {
    "use strict";
    __name(isDeduped, "isDeduped");
    __name(recordDedupe, "recordDedupe");
  }
});

// src/notify/dispatcher.ts
var dispatcher_exports = {};
__export(dispatcher_exports, {
  computeDedupKey: () => computeDedupKey,
  dispatch: () => dispatch
});
function computeDedupKey(event, now) {
  const day = now.toISOString().slice(0, 10);
  if (event.kind === "breach") return `${event.breach.breachKey}:${day}`;
  if (event.kind === "breach-suppressed") return `${event.breach.breachKey}:suppressed:${day}`;
  if (event.kind === "daily-report") return `daily-report:${day}`;
  if (event.kind === "approval-requested") return `approval-requested:${event.approvalId}`;
  return `deploy-guard-check:${day}`;
}
function logEntry(args) {
  return {
    id: args.id,
    createdAt: args.createdAt,
    actor: "notify:dispatcher",
    action: args.action,
    resourceType: "notification_channel",
    resourceId: args.channelName,
    details: args.result
  };
}
async function dispatch(args, deps) {
  const now = deps.clock();
  const dedupKey = computeDedupKey(args.event, now);
  const settled = await Promise.allSettled(
    args.channels.map(async (channel) => {
      const already = await isDeduped(
        {
          dedupKey,
          channelName: channel.name,
          windowSeconds: deps.dedupWindowSeconds,
          now
        },
        { db: deps.db }
      );
      if (already) {
        const r2 = ok(channel.name, dedupKey, now.toISOString());
        await deps.log(
          logEntry({
            id: crypto.randomUUID(),
            createdAt: now.toISOString(),
            action: "notification_deduped",
            channelName: channel.name,
            result: r2
          })
        );
        return r2;
      }
      const r = await channel.send({ event: args.event, dedupKey }, deps);
      if (r.ok) {
        await recordDedupe({ dedupKey, channelName: channel.name, now }, { db: deps.db });
      }
      await deps.log(
        logEntry({
          id: crypto.randomUUID(),
          createdAt: now.toISOString(),
          action: r.ok ? "notification_sent" : "notification_failed",
          channelName: channel.name,
          result: r
        })
      );
      return r;
    })
  );
  return settled.map(
    (s, i) => s.status === "fulfilled" ? s.value : {
      ok: false,
      channel: args.channels[i].name,
      error: { code: "NON_2XX", message: s.reason?.message ?? "unknown" }
    }
  );
}
var init_dispatcher = __esm({
  "src/notify/dispatcher.ts"() {
    "use strict";
    init_types2();
    init_dedupe();
    __name(computeDedupKey, "computeDedupKey");
    __name(logEntry, "logEntry");
    __name(dispatch, "dispatch");
  }
});

// src/notify/adapters/discord.ts
function title(e) {
  switch (e.kind) {
    case "breach":
      return `Workers Usage Alert [${e.severity.toUpperCase()}]`;
    case "breach-suppressed":
      return `Breach suppressed (${e.reason})`;
    case "daily-report":
      return "Workers Usage \u2014 Daily Report";
    case "deploy-guard-check":
      return `Guard health: ${e.result}`;
    case "approval-requested":
      return `Approval required: ${e.scriptName}`;
  }
}
function fieldsFor(e) {
  if (e.kind === "breach") {
    return [
      { name: "Script", value: e.breach.breachKey, inline: true },
      { name: "Triggered", value: e.breach.triggeredAt, inline: true },
      { name: "Rule", value: e.breach.ruleId, inline: true },
      {
        name: "Actions",
        value: `routes removed: ${e.actions.removedRoutes.length}
domains detached: ${e.actions.removedDomains.length}
**Note:** workers.dev subdomain may still be reachable.`
      }
    ];
  }
  if (e.kind === "daily-report") {
    const p = e.report.payload;
    const top = [...p.perWorker].sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd).slice(0, 5);
    return [
      { name: "Total est. cost (USD)", value: p.totals.estimatedCostUsd.toFixed(2), inline: true },
      { name: "Savings this month", value: `$${p.savingsThisMonthUsd.toFixed(2)}`, inline: true },
      { name: "Top 5 workers by cost", value: top.map((w) => `\u2022 ${w.scriptName}: $${w.estimatedCostUsd.toFixed(2)}`).join("\n") || "_none_" }
    ];
  }
  if (e.kind === "breach-suppressed") {
    return [
      { name: "Script", value: e.breach.breachKey },
      { name: "Reason", value: e.reason }
    ];
  }
  if (e.kind === "approval-requested") {
    return [
      { name: "Approval ID", value: e.approvalId, inline: true },
      { name: "Script", value: e.scriptName, inline: true },
      { name: "Rule", value: e.ruleId, inline: true },
      { name: "Breach type", value: e.breachType, inline: true },
      { name: "Actual", value: String(e.actualValue), inline: true },
      { name: "Limit", value: String(e.limitValue), inline: true },
      { name: "Action", value: "Run `wd guard approve " + e.approvalId + " --account " + e.accountId + "` to allow, or `wd guard reject " + e.approvalId + " --account " + e.accountId + "` to block." }
    ];
  }
  return [{ name: "Details", value: e.details }];
}
function discordAdapter(config) {
  return {
    name: config.name,
    kind: "discord",
    async send({ event, dedupKey }, deps) {
      if (config.minSeverity && SEVERITY_RANK[event.severity] < SEVERITY_RANK[config.minSeverity]) {
        return ok(config.name, dedupKey, deps.clock().toISOString());
      }
      const url = deps.secrets(config.webhookUrlSecret);
      if (!url) return err(config.name, "BAD_CONFIG", `missing secret ${config.webhookUrlSecret}`);
      const v = deps.ssrf.validate(url);
      if (!v.ok) return err(config.name, "SSRF", v.reason);
      const body = JSON.stringify({
        embeds: [
          {
            title: title(event),
            color: COLOR[event.severity],
            timestamp: deps.clock().toISOString(),
            fields: fieldsFor(event)
          }
        ]
      });
      try {
        const res = await postWithTimeout({ url, body }, { fetch: deps.fetch });
        if (res.status < 200 || res.status >= 300) {
          return err(config.name, "NON_2XX", `HTTP ${res.status}: ${res.bodyText.slice(0, 200)}`);
        }
        return ok(config.name, dedupKey, deps.clock().toISOString());
      } catch (e) {
        const msg = e.message;
        if (/abort/i.test(msg)) return err(config.name, "TIMEOUT", msg);
        return err(config.name, "NON_2XX", msg);
      }
    }
  };
}
var COLOR, SEVERITY_RANK;
var init_discord = __esm({
  "src/notify/adapters/discord.ts"() {
    "use strict";
    init_types2();
    COLOR = { info: 3447003, warning: 15844367, critical: 15158332 };
    SEVERITY_RANK = { info: 0, warning: 1, critical: 2 };
    __name(title, "title");
    __name(fieldsFor, "fieldsFor");
    __name(discordAdapter, "discordAdapter");
  }
});

// src/notify/adapters/slack.ts
function blocksFor(e) {
  const header = {
    type: "header",
    text: { type: "plain_text", text: headerText(e) }
  };
  const body = { type: "section", text: { type: "mrkdwn", text: bodyText(e) } };
  return [header, body];
}
function headerText(e) {
  if (e.kind === "breach") return `:rotating_light: Workers Usage Alert [${e.severity.toUpperCase()}]`;
  if (e.kind === "daily-report") return ":chart_with_upwards_trend: Workers Usage \u2014 Daily Report";
  if (e.kind === "breach-suppressed") return ":mute: Breach suppressed";
  if (e.kind === "approval-requested") return `:warning: Approval required: ${e.scriptName}`;
  return ":information_source: Guard health";
}
function bodyText(e) {
  if (e.kind === "breach") {
    return [
      `*Script:* \`${e.breach.breachKey}\``,
      `*Rule:* ${e.breach.ruleId}`,
      `*Routes removed:* ${e.actions.removedRoutes.length}`,
      `*Domains detached:* ${e.actions.removedDomains.length}`,
      `*Note:* workers.dev subdomain may still be reachable.`
    ].join("\n");
  }
  if (e.kind === "daily-report") {
    const p = e.report.payload;
    const top = [...p.perWorker].sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd).slice(0, 5);
    return [
      `*Total est. cost:* $${p.totals.estimatedCostUsd.toFixed(2)}`,
      `*Savings this month:* $${p.savingsThisMonthUsd.toFixed(2)}`,
      "*Top 5:*",
      ...top.map((w) => `\u2022 ${w.scriptName}: $${w.estimatedCostUsd.toFixed(2)}`)
    ].join("\n");
  }
  if (e.kind === "breach-suppressed") return `${e.breach.breachKey} \u2014 reason: ${e.reason}`;
  if (e.kind === "approval-requested") {
    return [
      `*Approval ID:* \`${e.approvalId}\``,
      `*Script:* ${e.scriptName}`,
      `*Rule:* ${e.ruleId} (${e.breachType})`,
      `*Actual:* ${e.actualValue} / *Limit:* ${e.limitValue}`,
      `Run \`wd guard approve ${e.approvalId} --account ${e.accountId}\` to allow, or \`wd guard reject ${e.approvalId} --account ${e.accountId}\` to block.`
    ].join("\n");
  }
  return e.details;
}
function slackAdapter(config) {
  return {
    name: config.name,
    kind: "slack",
    async send({ event, dedupKey }, deps) {
      if (config.minSeverity && SEVERITY_RANK2[event.severity] < SEVERITY_RANK2[config.minSeverity]) {
        return ok(config.name, dedupKey, deps.clock().toISOString());
      }
      const url = deps.secrets(config.webhookUrlSecret);
      if (!url) return err(config.name, "BAD_CONFIG", `missing secret ${config.webhookUrlSecret}`);
      const v = deps.ssrf.validate(url);
      if (!v.ok) return err(config.name, "SSRF", v.reason);
      const body = JSON.stringify({ blocks: blocksFor(event) });
      try {
        const res = await postWithTimeout({ url, body }, { fetch: deps.fetch });
        if (res.status < 200 || res.status >= 300) {
          return err(config.name, "NON_2XX", `HTTP ${res.status}: ${res.bodyText.slice(0, 200)}`);
        }
        return ok(config.name, dedupKey, deps.clock().toISOString());
      } catch (e) {
        const msg = e.message;
        if (/abort/i.test(msg)) return err(config.name, "TIMEOUT", msg);
        return err(config.name, "NON_2XX", msg);
      }
    }
  };
}
var SEVERITY_RANK2;
var init_slack = __esm({
  "src/notify/adapters/slack.ts"() {
    "use strict";
    init_types2();
    SEVERITY_RANK2 = { info: 0, warning: 1, critical: 2 };
    __name(blocksFor, "blocksFor");
    __name(headerText, "headerText");
    __name(bodyText, "bodyText");
    __name(slackAdapter, "slackAdapter");
  }
});

// src/notify/adapters/webhook.ts
function webhookAdapter(config) {
  return {
    name: config.name,
    kind: "webhook",
    async send({ event, dedupKey }, deps) {
      if (config.minSeverity && SEVERITY_RANK3[event.severity] < SEVERITY_RANK3[config.minSeverity]) {
        return ok(config.name, dedupKey, deps.clock().toISOString());
      }
      const url = deps.secrets(config.urlSecret);
      if (!url) return err(config.name, "BAD_CONFIG", `missing secret ${config.urlSecret}`);
      const v = deps.ssrf.validate(url);
      if (!v.ok) return err(config.name, "SSRF", v.reason);
      const body = JSON.stringify({ dedupKey, event, sentAt: deps.clock().toISOString() });
      try {
        const res = await postWithTimeout(
          { url, body, headers: config.headers ?? {} },
          { fetch: deps.fetch }
        );
        if (res.status < 200 || res.status >= 300) {
          return err(config.name, "NON_2XX", `HTTP ${res.status}: ${res.bodyText.slice(0, 200)}`);
        }
        return ok(config.name, dedupKey, deps.clock().toISOString());
      } catch (e) {
        const msg = e.message;
        if (/abort/i.test(msg)) return err(config.name, "TIMEOUT", msg);
        return err(config.name, "NON_2XX", msg);
      }
    }
  };
}
var SEVERITY_RANK3;
var init_webhook = __esm({
  "src/notify/adapters/webhook.ts"() {
    "use strict";
    init_types2();
    SEVERITY_RANK3 = { info: 0, warning: 1, critical: 2 };
    __name(webhookAdapter, "webhookAdapter");
  }
});

// src/notify/ssrf.ts
var ssrf_exports = {};
__export(ssrf_exports, {
  ssrfValidator: () => ssrfValidator,
  validateWebhookUrl: () => validateWebhookUrl
});
function ipv4ToInt(parts) {
  return (parts[0] << 24 | parts[1] << 16 | parts[2] << 8 | parts[3]) >>> 0;
}
function isPrivateV4(host) {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const ip = [+m[1], +m[2], +m[3], +m[4]];
  if (ip.some((o) => o < 0 || o > 255)) return true;
  const ipInt = ipv4ToInt(ip);
  for (const { net, mask } of PRIVATE_V4) {
    const netInt = ipv4ToInt(net);
    const bits = mask === 0 ? 0 : 4294967295 << 32 - mask >>> 0;
    if ((ipInt & bits) === (netInt & bits)) return true;
  }
  return false;
}
function validateWebhookUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "malformed URL" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "https required" };
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return { ok: false, reason: "localhost" };
  if (isPrivateV4(host)) return { ok: false, reason: "private or reserved IPv4" };
  return { ok: true };
}
var PRIVATE_V4, ssrfValidator;
var init_ssrf = __esm({
  "src/notify/ssrf.ts"() {
    "use strict";
    PRIVATE_V4 = [
      { net: [10, 0, 0, 0], mask: 8 },
      { net: [172, 16, 0, 0], mask: 12 },
      { net: [192, 168, 0, 0], mask: 16 },
      { net: [127, 0, 0, 0], mask: 8 },
      { net: [169, 254, 0, 0], mask: 16 },
      { net: [0, 0, 0, 0], mask: 8 }
    ];
    __name(ipv4ToInt, "ipv4ToInt");
    __name(isPrivateV4, "isPrivateV4");
    __name(validateWebhookUrl, "validateWebhookUrl");
    ssrfValidator = { validate: validateWebhookUrl };
  }
});

// src/cloudflare/api.ts
async function cfFetch(args, deps) {
  const url = `https://api.cloudflare.com/client/v4${args.path}`;
  const res = await deps.fetch(url, {
    method: args.method ?? "GET",
    headers: {
      authorization: `Bearer ${deps.token}`,
      "content-type": "application/json"
    },
    body: args.body ? JSON.stringify(args.body) : void 0
  });
  const text = await res.text();
  if (res.status < 200 || res.status >= 300) {
    throw new Error(
      `Cloudflare API ${args.method ?? "GET"} ${args.path} failed: ${res.status} ${text.slice(0, 500)}`
    );
  }
  const parsed = text ? JSON.parse(text) : { result: void 0 };
  return parsed.result;
}
var init_api2 = __esm({
  "src/cloudflare/api.ts"() {
    "use strict";
    __name(cfFetch, "cfFetch");
  }
});

// src/cloudflare/routes.ts
async function detachRoutesForWorker(args, deps) {
  const removed = [];
  for (const { zoneId } of args.zones) {
    const routes = await cfFetch({ path: `/zones/${zoneId}/workers/routes` }, deps);
    for (const r of routes.filter((x) => x.script === args.scriptName)) {
      await cfFetch({ path: `/zones/${zoneId}/workers/routes/${r.id}`, method: "DELETE" }, deps);
      removed.push({ zoneId, routeId: r.id, pattern: r.pattern });
    }
  }
  return removed;
}
var init_routes = __esm({
  "src/cloudflare/routes.ts"() {
    "use strict";
    init_api2();
    __name(detachRoutesForWorker, "detachRoutesForWorker");
  }
});

// src/cloudflare/domains.ts
async function detachDomainsForWorker(args, deps) {
  const domains = await cfFetch(
    { path: `/accounts/${args.accountId}/workers/domains` },
    deps
  );
  const removed = [];
  for (const d of domains.filter((x) => x.service === args.scriptName)) {
    await cfFetch(
      { path: `/accounts/${args.accountId}/workers/domains/${d.id}`, method: "DELETE" },
      deps
    );
    removed.push(d.hostname);
  }
  return removed;
}
var init_domains = __esm({
  "src/cloudflare/domains.ts"() {
    "use strict";
    init_api2();
    __name(detachDomainsForWorker, "detachDomainsForWorker");
  }
});

// src/cloudflare/workers-dev.ts
async function disableWorkersDevSubdomain(args, deps) {
  await cfFetch(
    {
      path: `/accounts/${args.accountId}/workers/services/${args.scriptName}/subdomain`,
      method: "PUT",
      body: { enabled: false }
    },
    deps
  );
}
var init_workers_dev = __esm({
  "src/cloudflare/workers-dev.ts"() {
    "use strict";
    init_api2();
    __name(disableWorkersDevSubdomain, "disableWorkersDevSubdomain");
  }
});

// src/workflows/kill-switch-deps.ts
var kill_switch_deps_exports = {};
__export(kill_switch_deps_exports, {
  makeKillSwitchDeps: () => makeKillSwitchDeps
});
function channelFor(cfg) {
  if (cfg.type === "discord") return discordAdapter(cfg);
  if (cfg.type === "slack") return slackAdapter(cfg);
  return webhookAdapter(cfg);
}
function makeKillSwitchDeps(env) {
  const token = env.CLOUDFLARE_API_TOKEN;
  const notifyConfig = loadNotificationConfig(env.NOTIFICATIONS_JSON);
  const channels = notifyConfig.channels.map(channelFor);
  return {
    now: /* @__PURE__ */ __name(() => /* @__PURE__ */ new Date(), "now"),
    id: /* @__PURE__ */ __name(() => crypto.randomUUID(), "id"),
    loadRuntimeProtectedSet: /* @__PURE__ */ __name(() => loadRuntimeProtectedSet({ db: env.DB }), "loadRuntimeProtectedSet"),
    isProtected,
    detachRoutes: /* @__PURE__ */ __name((args) => detachRoutesForWorker(args, { fetch, token }), "detachRoutes"),
    detachDomains: /* @__PURE__ */ __name((args) => detachDomainsForWorker(args, { fetch, token }), "detachDomains"),
    disableWorkersDev: /* @__PURE__ */ __name((args) => disableWorkersDevSubdomain(args, { fetch, token }), "disableWorkersDev"),
    insertForensic: /* @__PURE__ */ __name((args) => insertBreachForensic(args, { db: env.DB }), "insertForensic"),
    completeForensic: /* @__PURE__ */ __name((args) => completeBreachForensic(args, { db: env.DB }), "completeForensic"),
    appendActivity: /* @__PURE__ */ __name((args) => appendActivity(args, { db: env.DB }), "appendActivity"),
    setGraceUntil: /* @__PURE__ */ __name((args) => setGraceUntil(args, { db: env.DB }), "setGraceUntil"),
    dispatch: /* @__PURE__ */ __name(async ({ breachForensic, actions, severity }) => {
      return dispatch(
        { event: { kind: "breach", severity, breach: breachForensic, actions }, channels },
        {
          fetch,
          clock: /* @__PURE__ */ __name(() => /* @__PURE__ */ new Date(), "clock"),
          ssrf: ssrfValidator,
          secrets: /* @__PURE__ */ __name((name) => typeof env[name] === "string" ? env[name] : void 0, "secrets"),
          log: /* @__PURE__ */ __name(async (entry) => {
            await appendActivity({ event: entry }, { db: env.DB });
          }, "log"),
          db: env.DB,
          dedupWindowSeconds: notifyConfig.dedupWindowSeconds
        }
      );
    }, "dispatch")
  };
}
var init_kill_switch_deps = __esm({
  "src/workflows/kill-switch-deps.ts"() {
    "use strict";
    init_protected();
    init_routes();
    init_domains();
    init_workers_dev();
    init_forensics();
    init_activity();
    init_state();
    init_runtime_protected();
    init_dispatcher();
    init_config();
    init_ssrf();
    init_discord();
    init_slack();
    init_webhook();
    __name(channelFor, "channelFor");
    __name(makeKillSwitchDeps, "makeKillSwitchDeps");
  }
});

// src/workflows/kill-switch.ts
import {
  WorkflowEntrypoint
} from "cloudflare:workers";
async function stepProtectedCheck(args, deps) {
  const protectedFlag = deps.isProtected({
    scriptName: args.scriptName,
    guardScriptName: args.guardScriptName,
    account: args.account,
    runtimeProtected: args.runtimeProtected
  });
  if (protectedFlag) {
    await deps.appendActivity({
      event: {
        id: deps.id(),
        createdAt: deps.now().toISOString(),
        actor: "workflow:kill-switch",
        action: "protected_shortcircuit",
        resourceType: "worker",
        resourceId: args.scriptName,
        details: { breachKey: args.breachKey, workflowInstanceId: args.workflowInstanceId }
      }
    });
    return { proceed: false };
  }
  return { proceed: true };
}
async function stepCaptureForensics(args, deps) {
  const now = deps.now();
  const forensic = {
    id: deps.id(),
    breachKey: args.params.breachKey,
    workflowInstanceId: args.workflowInstanceId,
    triggeredAt: now.toISOString(),
    ruleId: args.params.ruleId,
    graphqlResponse: args.graphqlResponse,
    actionsTaken: null,
    estimatedSavingsUsd: null
  };
  await deps.insertForensic({ forensic });
  return { forensic };
}
async function stepDetachRoutes(args, deps) {
  return deps.detachRoutes({ scriptName: args.params.scriptName, zones: args.params.zones });
}
async function stepDetachDomains(args, deps) {
  return deps.detachDomains({ accountId: args.params.accountId, scriptName: args.params.scriptName });
}
async function stepDisableWorkersDev(args, deps) {
  return deps.disableWorkersDev({ accountId: args.params.accountId, scriptName: args.params.scriptName });
}
async function stepNotify(args, deps) {
  return deps.dispatch(args);
}
async function stepLogActivity(args, deps) {
  for (const r of args.removedRoutes) {
    await deps.appendActivity({
      event: {
        id: deps.id(),
        createdAt: deps.now().toISOString(),
        actor: "workflow:kill-switch",
        action: "routes_detached",
        resourceType: "zone_route",
        resourceId: r.routeId,
        details: {
          accountId: args.accountId,
          scriptName: args.scriptName,
          zoneId: r.zoneId,
          pattern: r.pattern,
          workflowInstanceId: args.workflowInstanceId
        }
      }
    });
  }
  for (const host of args.removedDomains) {
    await deps.appendActivity({
      event: {
        id: deps.id(),
        createdAt: deps.now().toISOString(),
        actor: "workflow:kill-switch",
        action: "domain_detached",
        resourceType: "worker_domain",
        resourceId: host,
        details: {
          accountId: args.accountId,
          scriptName: args.scriptName,
          workflowInstanceId: args.workflowInstanceId
        }
      }
    });
  }
}
async function stepSetGrace(args, deps) {
  const graceUntil = new Date(deps.now().getTime() + args.graceSeconds * 1e3).toISOString();
  await deps.setGraceUntil({ breachKey: args.breachKey, graceUntil });
}
async function stepAwaitApproval(args, deps) {
  const approvalId = deps.id();
  const now = deps.now();
  await deps.createApproval({
    id: approvalId,
    accountId: args.accountId,
    scriptName: args.scriptName,
    breachKey: args.breachKey,
    workflowInstanceId: args.workflowInstanceId,
    ruleId: args.ruleId,
    breachType: args.breachType,
    actualValue: args.actualValue,
    limitValue: args.limitValue,
    expiresInSeconds: args.approvalTimeoutSeconds,
    now
  });
  await deps.dispatchApprovalNotification(approvalId);
  const deadline = now.getTime() + args.approvalTimeoutSeconds * 1e3;
  while (deps.now().getTime() < deadline) {
    const approval = await deps.getApproval({ id: approvalId });
    if (approval && approval.status !== "pending") {
      return { decision: approval.status };
    }
    await args.sleep("wait-for-approval", args.pollIntervalSeconds);
  }
  return { decision: "expired" };
}
var OverageWorkflow;
var init_kill_switch = __esm({
  "src/workflows/kill-switch.ts"() {
    "use strict";
    __name(stepProtectedCheck, "stepProtectedCheck");
    __name(stepCaptureForensics, "stepCaptureForensics");
    __name(stepDetachRoutes, "stepDetachRoutes");
    __name(stepDetachDomains, "stepDetachDomains");
    __name(stepDisableWorkersDev, "stepDisableWorkersDev");
    __name(stepNotify, "stepNotify");
    __name(stepLogActivity, "stepLogActivity");
    __name(stepSetGrace, "stepSetGrace");
    __name(stepAwaitApproval, "stepAwaitApproval");
    OverageWorkflow = class extends WorkflowEntrypoint {
      static {
        __name(this, "OverageWorkflow");
      }
      async run(event, step) {
        const { makeKillSwitchDeps: makeKillSwitchDeps2 } = await Promise.resolve().then(() => (init_kill_switch_deps(), kill_switch_deps_exports));
        const deps = makeKillSwitchDeps2(this.env);
        const params = event.payload;
        const wfId = event.instanceId;
        const { loadAccountConfig: loadAccountConfig2 } = await Promise.resolve().then(() => (init_config(), config_exports));
        const accounts = loadAccountConfig2(this.env.ACCOUNTS_JSON);
        const account = accounts.find((a) => a.accountId === params.accountId);
        if (!account) return;
        const runtimeProtected = await step.do(
          "load-runtime-protected",
          async () => deps.loadRuntimeProtectedSet()
        );
        const { proceed } = await step.do(
          "protected-check",
          async () => stepProtectedCheck(
            {
              accountId: params.accountId,
              scriptName: params.scriptName,
              guardScriptName: this.env.GUARD_SCRIPT_NAME,
              account,
              breachKey: params.breachKey,
              workflowInstanceId: wfId,
              runtimeProtected
            },
            deps
          )
        );
        if (!proceed) return;
        const { createApproval: createApproval2, getApproval: getApproval2 } = await Promise.resolve().then(() => (init_approvals(), approvals_exports));
        const { loadNotificationConfig: loadNotificationConfig2 } = await Promise.resolve().then(() => (init_config(), config_exports));
        const { channelFor: channelFor3 } = await Promise.resolve().then(() => (init_index(), index_exports));
        const notifyConfig = loadNotificationConfig2(this.env.NOTIFICATIONS_JSON);
        const channels = notifyConfig.channels.map(channelFor3);
        const { dispatch: dispatch2 } = await Promise.resolve().then(() => (init_dispatcher(), dispatcher_exports));
        const { ssrfValidator: ssrfValidator2 } = await Promise.resolve().then(() => (init_ssrf(), ssrf_exports));
        const { appendActivity: appendActivity2 } = await Promise.resolve().then(() => (init_activity(), activity_exports));
        const approvalResult = await step.do(
          "await-approval",
          async () => stepAwaitApproval(
            {
              accountId: params.accountId,
              scriptName: params.scriptName,
              breachKey: params.breachKey,
              workflowInstanceId: wfId,
              ruleId: params.ruleId,
              breachType: params.breachType,
              actualValue: params.actual,
              limitValue: params.limit,
              approvalTimeoutSeconds: 3600,
              pollIntervalSeconds: 30,
              sleep: /* @__PURE__ */ __name((label, seconds) => step.sleep(label, seconds), "sleep")
            },
            {
              ...deps,
              createApproval: /* @__PURE__ */ __name((a) => createApproval2(a, { db: this.env.DB }), "createApproval"),
              getApproval: /* @__PURE__ */ __name((a) => getApproval2(a, { db: this.env.DB }), "getApproval"),
              dispatchApprovalNotification: /* @__PURE__ */ __name(async (approvalId) => {
                await dispatch2(
                  {
                    event: {
                      kind: "approval-requested",
                      severity: "warning",
                      approvalId,
                      accountId: params.accountId,
                      scriptName: params.scriptName,
                      ruleId: params.ruleId,
                      breachType: params.breachType,
                      actualValue: params.actual,
                      limitValue: params.limit
                    },
                    channels
                  },
                  {
                    fetch,
                    clock: /* @__PURE__ */ __name(() => /* @__PURE__ */ new Date(), "clock"),
                    ssrf: ssrfValidator2,
                    secrets: /* @__PURE__ */ __name((name) => typeof this.env[name] === "string" ? this.env[name] : void 0, "secrets"),
                    log: /* @__PURE__ */ __name(async (entry) => {
                      await appendActivity2({ event: entry }, { db: this.env.DB });
                    }, "log"),
                    db: this.env.DB,
                    dedupWindowSeconds: notifyConfig.dedupWindowSeconds
                  }
                );
              }, "dispatchApprovalNotification")
            }
          )
        );
        if (approvalResult.decision === "rejected" || approvalResult.decision === "expired") {
          await deps.appendActivity({
            event: {
              id: deps.id(),
              createdAt: deps.now().toISOString(),
              actor: "workflow:kill-switch",
              action: `approval_${approvalResult.decision}`,
              resourceType: "worker",
              resourceId: params.scriptName,
              details: { breachKey: params.breachKey, workflowInstanceId: wfId }
            }
          });
          return;
        }
        const { forensic } = await step.do(
          "capture-forensics",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          async () => stepCaptureForensics({ params, workflowInstanceId: wfId, graphqlResponse: {} }, deps)
        );
        const removedRoutes = await step.do(
          "detach-routes",
          async () => stepDetachRoutes({ params }, deps)
        );
        const removedDomains = await step.do(
          "detach-custom-domains",
          async () => stepDetachDomains({ params }, deps)
        );
        await step.do(
          "disable-workers-dev",
          async () => stepDisableWorkersDev({ params }, deps)
        );
        const actions = { removedRoutes, removedDomains };
        await step.do(
          "notify",
          async () => stepNotify({ breachForensic: forensic, actions, severity: "critical" }, deps)
        );
        await step.do(
          "log-activity",
          async () => stepLogActivity(
            {
              workflowInstanceId: wfId,
              accountId: params.accountId,
              scriptName: params.scriptName,
              removedRoutes,
              removedDomains
            },
            deps
          )
        );
        const worker = account.workers.find((w) => w.scriptName === params.scriptName);
        const graceSeconds = worker?.graceSeconds ?? Number(this.env.OVERAGE_GRACE_SECONDS);
        await step.do(
          "set-grace-period",
          async () => stepSetGrace({ breachKey: params.breachKey, graceSeconds }, deps)
        );
        await deps.completeForensic({ id: forensic.id, actions, estimatedSavingsUsd: 0 });
      }
    };
  }
});

// src/index.ts
var index_exports = {};
__export(index_exports, {
  OverageWorkflow: () => OverageWorkflow,
  channelFor: () => channelFor2,
  default: () => index_default
});
function channelFor2(cfg) {
  if (cfg.type === "discord") return discordAdapter(cfg);
  if (cfg.type === "slack") return slackAdapter(cfg);
  return webhookAdapter(cfg);
}
function makeDispatch(env, channels, dedupWindowSeconds) {
  return async (event) => dispatch(
    { event, channels },
    {
      fetch,
      clock: /* @__PURE__ */ __name(() => /* @__PURE__ */ new Date(), "clock"),
      ssrf: ssrfValidator,
      secrets: /* @__PURE__ */ __name((name) => typeof env[name] === "string" ? env[name] : void 0, "secrets"),
      log: /* @__PURE__ */ __name(async (entry) => {
        await appendActivity({ event: entry }, { db: env.DB });
      }, "log"),
      db: env.DB,
      dedupWindowSeconds
    }
  );
}
var index_default;
var init_index = __esm({
  "src/index.ts"() {
    init_config();
    init_overage_check();
    init_daily();
    init_api();
    init_queries();
    init_protected();
    init_runtime_protected();
    init_approvals();
    init_state();
    init_snapshots();
    init_activity();
    init_reports();
    init_forensics();
    init_snapshots();
    init_reports();
    init_dispatcher();
    init_discord();
    init_slack();
    init_webhook();
    init_ssrf();
    init_kill_switch();
    __name(channelFor2, "channelFor");
    __name(makeDispatch, "makeDispatch");
    index_default = {
      async scheduled(controller, env, ctx) {
        const accounts = loadAccountConfig(env.ACCOUNTS_JSON);
        const notifyConfig = loadNotificationConfig(env.NOTIFICATIONS_JSON);
        const channels = notifyConfig.channels.map(channelFor2);
        const token = env.CLOUDFLARE_API_TOKEN;
        if (controller.cron === "*/5 * * * *") {
          ctx.waitUntil(
            runOverageCheck(
              {
                accounts,
                defaults: {
                  requests: Number(env.REQUEST_THRESHOLD),
                  cpuMs: Number(env.CPU_TIME_THRESHOLD_MS),
                  costUsd: Number.POSITIVE_INFINITY
                },
                cooldownSeconds: Number(env.OVERAGE_COOLDOWN_SECONDS)
              },
              {
                now: /* @__PURE__ */ __name(() => /* @__PURE__ */ new Date(), "now"),
                id: /* @__PURE__ */ __name(() => crypto.randomUUID(), "id"),
                guardScriptName: env.GUARD_SCRIPT_NAME,
                loadRuntimeProtectedSet: /* @__PURE__ */ __name(() => loadRuntimeProtectedSet({ db: env.DB }), "loadRuntimeProtectedSet"),
                isProtected,
                fetchUsage: /* @__PURE__ */ __name((a) => fetchWorkerUsage(a, { fetch, token }), "fetchUsage"),
                getState: /* @__PURE__ */ __name((a) => getOverageState(a, { db: env.DB }), "getState"),
                upsertOnBreach: /* @__PURE__ */ __name((a) => upsertOverageStateOnBreach(a, { db: env.DB }), "upsertOnBreach"),
                setWorkflowInstanceId: /* @__PURE__ */ __name((a) => setWorkflowInstanceId(a, { db: env.DB }), "setWorkflowInstanceId"),
                insertSnapshot: /* @__PURE__ */ __name((a) => insertUsageSnapshot(a, { db: env.DB }), "insertSnapshot"),
                appendActivity: /* @__PURE__ */ __name((a) => appendActivity(a, { db: env.DB }), "appendActivity"),
                createWorkflow: /* @__PURE__ */ __name(async (a) => {
                  const instance = await env.OVERAGE_WORKFLOW.create({ id: a.id, params: a.params });
                  return { id: instance.id };
                }, "createWorkflow")
              }
            )
          );
          return;
        }
        if (controller.cron === "0 8 * * *") {
          const dispatcher = makeDispatch(env, channels, notifyConfig.dedupWindowSeconds);
          ctx.waitUntil(
            runDailyReport(
              { accounts },
              {
                now: /* @__PURE__ */ __name(() => /* @__PURE__ */ new Date(), "now"),
                id: /* @__PURE__ */ __name(() => crypto.randomUUID(), "id"),
                fetchUsage: /* @__PURE__ */ __name((a) => fetchWorkerUsage(a, { fetch, token }), "fetchUsage"),
                insertReport: /* @__PURE__ */ __name((a) => insertUsageReport(a, { db: env.DB }), "insertReport"),
                dispatch: /* @__PURE__ */ __name((a) => dispatcher({ kind: "daily-report", severity: "info", report: a.report }), "dispatch")
              }
            )
          );
          return;
        }
      },
      async fetch(request, env) {
        const healthQuery = /* @__PURE__ */ __name(async () => {
          const reports = await listRecentReports({ accountId: "-", limit: 1 }, { db: env.DB }).catch(() => []);
          const breaches = await listRecentBreaches({ accountId: "-", limit: 1 }, { db: env.DB }).catch(() => []);
          return {
            lastCheck: breaches[0]?.triggeredAt ?? null,
            lastReport: reports[0]?.generatedAt ?? null
          };
        }, "healthQuery");
        return handleApiRequest(
          { request },
          {
            now: /* @__PURE__ */ __name(() => /* @__PURE__ */ new Date(), "now"),
            signingKey: env.GUARD_API_SIGNING_KEY,
            listReports: /* @__PURE__ */ __name((a) => listRecentReports(a, { db: env.DB }), "listReports"),
            listBreaches: /* @__PURE__ */ __name((a) => listRecentBreaches(a, { db: env.DB }), "listBreaches"),
            listSnapshots: /* @__PURE__ */ __name((a) => listRecentSnapshots({ accountId: a.accountId, scriptName: a.scriptName, limit: 288 }, { db: env.DB }), "listSnapshots"),
            healthInfo: healthQuery,
            addRuntimeProtection: /* @__PURE__ */ __name((a) => addRuntimeProtection(a, { db: env.DB }), "addRuntimeProtection"),
            removeRuntimeProtection: /* @__PURE__ */ __name((a) => removeRuntimeProtection(a, { db: env.DB }), "removeRuntimeProtection"),
            listRuntimeProtectedOn: /* @__PURE__ */ __name((a) => listRuntimeProtected({ accountId: a.accountId }, { db: env.DB }), "listRuntimeProtectedOn"),
            listPendingApprovals: /* @__PURE__ */ __name((a) => listPendingApprovals(a, { db: env.DB }), "listPendingApprovals"),
            decideApproval: /* @__PURE__ */ __name((a) => decideApproval(a, { db: env.DB }), "decideApproval")
          }
        );
      }
    };
  }
});
init_index();
export {
  OverageWorkflow,
  channelFor2 as channelFor,
  index_default as default
};