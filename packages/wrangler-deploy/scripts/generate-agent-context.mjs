import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as ts from "typescript";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const typesPath = resolve(packageRoot, "src/types.ts");
const outputPath = resolve(packageRoot, "agent-context.json");

function createProgram() {
  return ts.createProgram([typesPath], {
    allowJs: false,
    noResolve: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
  });
}

function createChecker() {
  const program = createProgram();
  return {
    program,
    checker: program.getTypeChecker(),
    sourceFile: program.getSourceFile(typesPath),
  };
}

function textOf(node, sourceFile) {
  return node.getText(sourceFile).replace(/\s+/g, " ").trim();
}

function getDocs(checker, node) {
  const symbol = node.name && ts.isIdentifier(node.name) ? checker.getSymbolAtLocation(node.name) : undefined;
  const text = symbol ? ts.displayPartsToString(symbol.getDocumentationComment(checker)).trim() : "";
  return text || undefined;
}

function getInterfaceSchema(checker, sourceFile, interfaceName) {
  const declaration = sourceFile.statements.find(
    (statement) => ts.isInterfaceDeclaration(statement) && statement.name.text === interfaceName,
  );
  if (!declaration) {
    throw new Error(`Missing interface: ${interfaceName}`);
  }

  return {
    description: getDocs(checker, declaration),
    fields: declaration.members
      .filter((member) => ts.isPropertySignature(member) && ts.isIdentifier(member.name))
      .map((member) => ({
        name: member.name.text,
        type: member.type ? textOf(member.type, sourceFile) : "unknown",
        required: !member.questionToken,
        description: getDocs(checker, member),
      })),
  };
}

function getUnionLiterals(sourceFile, aliasName) {
  const declaration = sourceFile.statements.find(
    (statement) => ts.isTypeAliasDeclaration(statement) && statement.name.text === aliasName,
  );
  if (!declaration || !ts.isUnionTypeNode(declaration.type)) {
    throw new Error(`Missing union type alias: ${aliasName}`);
  }

  return declaration.type.types.map((typeNode) => {
    if (ts.isLiteralTypeNode(typeNode) && ts.isStringLiteral(typeNode.literal)) {
      return typeNode.literal.text;
    }
    return typeNode.getText(sourceFile);
  });
}

function buildAgentContext() {
  const { program, checker, sourceFile } = createChecker();
  if (!sourceFile) {
    throw new Error(`Unable to load ${typesPath}`);
  }

  void program;

  const schema = {
    source: "src/types.ts",
    unions: {
      ResourceType: {
        description: "Cloudflare resource kinds supported by wrangler-deploy.",
        values: getUnionLiterals(sourceFile, "ResourceType"),
      },
      LifecycleStatus: {
        description: "Stage resource lifecycle states tracked in persisted state.",
        values: getUnionLiterals(sourceFile, "LifecycleStatus"),
      },
    },
    interfaces: {
      CfStageConfig: getInterfaceSchema(checker, sourceFile, "CfStageConfig"),
      StageRule: getInterfaceSchema(checker, sourceFile, "StageRule"),
      StateConfig: getInterfaceSchema(checker, sourceFile, "StateConfig"),
      DevConfig: getInterfaceSchema(checker, sourceFile, "DevConfig"),
      DevSessionConfig: getInterfaceSchema(checker, sourceFile, "DevSessionConfig"),
      DevQueueRouteConfig: getInterfaceSchema(checker, sourceFile, "DevQueueRouteConfig"),
      DevEndpointConfig: getInterfaceSchema(checker, sourceFile, "DevEndpointConfig"),
      DevD1Config: getInterfaceSchema(checker, sourceFile, "DevD1Config"),
      ProjectContext: getInterfaceSchema(checker, sourceFile, "ProjectContext"),
      VerifyConfig: getInterfaceSchema(checker, sourceFile, "VerifyConfig"),
      LocalVerifyConfig: getInterfaceSchema(checker, sourceFile, "LocalVerifyConfig"),
      LocalVerifyPackConfig: getInterfaceSchema(checker, sourceFile, "LocalVerifyPackConfig"),
      WorkerFixtureConfig: getInterfaceSchema(checker, sourceFile, "WorkerFixtureConfig"),
      QueueFixtureConfig: getInterfaceSchema(checker, sourceFile, "QueueFixtureConfig"),
      D1FixtureConfig: getInterfaceSchema(checker, sourceFile, "D1FixtureConfig"),
      ResourceConfig: {
        description: "Discriminated union of provisionable resource definitions.",
        variants: ["KvResourceConfig", "QueueResourceConfig", "HyperdriveResourceConfig", "D1ResourceConfig", "R2ResourceConfig", "VectorizeResourceConfig"],
      },
      QueueBinding: {
        description: "Accepted binding shapes for queue resources.",
        variants: ["string", "QueueProducerBinding", "QueueConsumerBinding", "QueueDlqBinding"],
      },
      FixtureConfig: {
        description: "Shared fixture union used by worker, queue, and D1 workflows.",
        variants: ["WorkerFixtureConfig", "QueueFixtureConfig", "D1FixtureConfig"],
      },
      LocalVerifyCheckConfig: {
        description: "Union of local verification check definitions.",
        variants: ["LocalVerifyWorkerCheck", "LocalVerifyCronCheck", "LocalVerifyQueueCheck", "LocalVerifyD1Check", "LocalVerifyD1FileCheck"],
      },
    },
  };

  return {
    package: "wrangler-deploy",
    version: 1,
    description: "Agent-facing context for wrangler-deploy. Use this package to orchestrate staged Cloudflare Workers environments, inspect topology, and run local repo-aware workflows.",
    entrypoints: {
      cli: "wd",
      binary: "wrangler-deploy",
      schema: "wd schema --json",
    },
    machineReadable: {
      default: "json",
      fields: true,
      ndjson: true,
      preview: "dry-run",
    },
    commands: [
      { name: "create", kind: "generator", output: "text" },
      { name: "init", kind: "generator", output: "text" },
      { name: "introspect", kind: "generator", output: "json", mutating: true },
      { name: "plan", kind: "inspection", output: "json" },
      { name: "apply", kind: "mutating", output: "json", supportsDryRun: true },
      { name: "deploy", kind: "mutating", output: "json", supportsDryRun: true },
      { name: "up", kind: "mutating", output: "json", supportsDryRun: true },
      { name: "tail", kind: "workflow", output: "text" },
      { name: "rollback", kind: "mutating", output: "json", supportsDryRun: true },
      { name: "destroy", kind: "mutating", output: "json", supportsDryRun: true },
      { name: "gc", kind: "mutating", output: "json" },
      { name: "status", kind: "inspection", output: "json" },
      { name: "check", kind: "inspection", output: "json" },
      { name: "verify", kind: "inspection", output: "json" },
      { name: "graph", kind: "inspection", output: "graph" },
      { name: "impact", kind: "inspection", output: "json" },
      { name: "diff", kind: "inspection", output: "json" },
      { name: "doctor", kind: "inspection", output: "json" },
      { name: "open", kind: "workflow", output: "json" },
      { name: "dashboard", kind: "workflow", output: "json" },
      { name: "explain", kind: "inspection", output: "json" },
      { name: "examples", kind: "inspection", output: "json" },
      { name: "sandbox", kind: "utility", output: "json", subcommands: ["info", "run"] },
      { name: "schema", kind: "inspection", output: "json" },
      { name: "context", kind: "workflow", output: "json", subcommands: ["get", "set", "unset", "clear", "doctor", "export", "import"] },
      { name: "macro", kind: "workflow", output: "json", subcommands: ["list", "save", "run", "validate"] },
      { name: "history", kind: "inspection", output: "json" },
      { name: "env", kind: "inspection", output: "json", subcommands: ["diff"] },
      { name: "lock", kind: "workflow", output: "json", subcommands: ["status", "acquire", "release"] },
      { name: "replay", kind: "workflow", output: "json" },
      { name: "route", kind: "inspection", output: "json", subcommands: ["verify", "apply"] },
      { name: "onboard", kind: "utility", output: "json" },
      { name: "tools", kind: "inspection", output: "json" },
      { name: "secrets", kind: "workflow", output: "json", subcommands: ["check", "set", "sync"] },
      { name: "snapshot", kind: "workflow", output: "json", subcommands: ["list", "save", "load"] },
      { name: "fixture", kind: "workflow", output: "json", subcommands: ["list"] },
      { name: "worker", kind: "workflow", output: "json", subcommands: ["call", "routes"] },
      { name: "d1", kind: "workflow", output: "json", subcommands: ["list", "inspect", "exec", "execute", "seed", "reset", "migrations"] },
      { name: "queue", kind: "workflow", output: "json", subcommands: ["list", "inspect", "send", "replay", "tail"] },
      { name: "ci", kind: "workflow", output: "json", subcommands: ["init", "comment", "check"] },
      { name: "completions", kind: "utility", output: "text" },
      { name: "configure", kind: "workflow", output: "json", mutating: true },
      { name: "login", kind: "workflow", output: "json", mutating: true },
      { name: "logout", kind: "workflow", output: "json", mutating: true },
      { name: "auth", kind: "inspection", output: "json", subcommands: ["status", "check", "switch", "doctor", "pin"] },
      { name: "profile", kind: "inspection", output: "json", subcommands: ["list", "remove", "test"] },
      { name: "bootstrap", kind: "utility", output: "json" },
      { name: "quickstart", kind: "utility", output: "json" },
      { name: "release-note", kind: "utility", output: "json" },
      { name: "telemetry", kind: "workflow", output: "json", subcommands: ["on", "off", "status"] },
      { name: "version", kind: "utility", output: "json" },
      { name: "upgrade-check", kind: "utility", output: "json" },
      { name: "preflight", kind: "inspection", output: "json" },
      { name: "dev", kind: "workflow", output: "text", subcommands: ["doctor", "ui"] },
      { name: "logs", kind: "inspection", output: "json" },
      { name: "guard", kind: "workflow", output: "json", subcommands: ["init", "deploy", "migrate", "status", "breaches", "report", "disarm", "arm", "approvals", "approve", "reject"], mutating: true },
      { name: "state", kind: "inspection", output: "json", subcommands: ["list", "get", "tree"] },
      { name: "output", kind: "inspection", output: "json" },
      { name: "run", kind: "inspection", output: "json" },
      { name: "rotate-password", kind: "workflow", output: "json", mutating: true },
      { name: "cron", kind: "workflow", output: "json", subcommands: ["trigger", "loop"] },
      { name: "util", kind: "utility", output: "json", subcommands: ["create-cf-token"] },
      { name: "help", kind: "utility", output: "json" },
    ],
    schema,
    outputs: {
      structured: [
        "plan",
        "apply",
        "deploy",
        "destroy",
        "gc",
        "status",
        "verify",
        "graph",
        "impact",
        "diff",
        "doctor",
        "history",
        "env",
        "lock",
        "replay",
        "route",
        "onboard",
        "snapshot",
        "fixture",
        "worker",
        "d1",
        "queue",
        "ci",
        "secrets",
      ],
      dryRun: [
        "apply",
        "deploy",
        "destroy",
        "secrets set",
        "secrets sync",
      ],
    },
    agentNotes: [
      "Prefer --json for machine consumers and --dry-run before mutating commands.",
      "Use --fields to trim JSON output and --ndjson for streaming list workflows.",
      "Use schema output to discover commands and flags instead of scraping help text.",
      "Use wd create vite for greenfield starters and wd init for existing Wrangler repos.",
      "Project defaults can be stored in .wdrc or .wdrc.json at or above the repo root.",
      "Queue send payload input uses --payload and --payload-file.",
    ],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const content = JSON.stringify(buildAgentContext(), null, 2) + "\n";
  writeFileSync(outputPath, content);
  process.stdout.write(`Wrote ${outputPath}\n`);
}

export { buildAgentContext };
