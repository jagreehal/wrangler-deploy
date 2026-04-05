# wrangler-deploy Test Stories

| Key | Value |
| --- | --- |
| Date | 2026-04-06T08:16:43.875Z |
| Version | 1.0.2 |
| Git SHA | 5a741ba |

## src/github.test.ts

### GitHub automation

### ✅ does not call CLI flags that the current CLI does not expose

- **Given** the GitHub Action source and the CLI source
- **When** the action uses --json with the status command
- **Then** the CLI must also expose the --json flag

### ✅ only references example workflow commands that exist in the CLI help

- **Given** the example workflow and the CLI source
- **When** the workflow references the gc command
- **Then** the CLI must define the gc command

### ✅ declares a schedule trigger when a scheduled cleanup job exists

- **Given** the example workflow source
- **When** the workflow has a schedule-conditional cleanup job
- **Then** the workflow must declare a schedule trigger

## src/providers/cloudflare-api.test.ts

### cloudflare-api

### ✅ uses CLOUDFLARE_ACCOUNT_ID without fetching

- **Given** CLOUDFLARE_ACCOUNT_ID is set in the environment
- **When** resolveAccountId is called
- **Then** it returns the env var value without making any API calls

### ✅ caches resolved account ids between calls

- **Given** no CLOUDFLARE_ACCOUNT_ID in the environment
- **And** the API returns an account ID
- **When** resolveAccountId is called twice
- **Then** only one API call is made

### ✅ formats API errors from cfApiResult

- **Given** an API response with multiple error codes
- **When** cfApiResult parses the response
- **Then** it throws with all error codes and messages formatted

## src/providers/local-cli.test.ts

### local CLI-backed providers

### ✅ extracts the created D1 database id from wrangler output

- **Given** wrangler output containing a D1 database UUID
- **When** the UUID regex runs against the output
- **Then** the database ID is extracted

### ✅ treats existing R2 buckets as non-fatal based on error message matching

- **Given** an error message indicating a bucket already exists
- **When** the error is checked for the 'already exists' pattern
- **Then** the match succeeds, allowing the error to be treated as non-fatal

## src/providers/resources.test.ts

### providers

### ✅ adopts an existing KV namespace when create reports conflict

- **Given** the Cloudflare API rejects KV creation with a conflict error
- **And** a subsequent list call returns the existing namespace
- **When** createKvNamespace is called
- **Then** the existing namespace is adopted

### ✅ adopts an existing queue when create returns conflict

- **Given** the Cloudflare API rejects queue creation with a 409 conflict
- **And** a subsequent list call returns the existing queue
- **When** createQueue is called
- **Then** the existing queue is adopted

### ✅ adopts an existing Hyperdrive config when create returns conflict

- **Given** the Cloudflare API rejects Hyperdrive creation with a 409 conflict
- **And** a subsequent list call returns the existing config
- **When** createHyperdrive is called
- **Then** the existing Hyperdrive config is adopted

### ✅ treats worker deletion as idempotent on 404

- **Given** the Cloudflare API returns 404 for a worker deletion
- **When** deleteWorker is called
- **Then** it resolves without error

## src/core/apply.test.ts

### plan

### ✅ reports all resources as create when no state exists

- **Given** a config with KV and D1 resources and no existing state
- **When** plan is computed
- **Then** all resources should be marked for creation

### ✅ reports resources as in-sync when state has them active

- **Given** state with both resources active
- **When** plan is computed
- **Then** all resources should be in-sync

### ✅ uses the resource name from state for existing resources instead of recomputing it

- **Given** state with an active resource whose live name differs from resourceName(logicalName, stage)
- **When** plan is computed
- **Then** the existing resource should be reported using the authoritative state name

### ✅ detects orphaned resources in state but not in config

- **Given** state has a resource removed from config
- **When** plan is computed
- **Then** the removed resource should be orphaned

### ✅ reports drifted resources from state

- **Given** state has a resource marked as drifted
- **When** plan is computed
- **Then** the resource should be reported as drifted

### ✅ treats missing resources in state as orphaned in the plan output

- **Given** state has a manifest resource marked as missing
- **When** plan is computed
- **Then** the item should use a valid plan action rather than raw 'missing'

### apply

### ✅ creates resources and writes state after each one

- **Given** a config with KV and D1 resources and no existing state
- **When** apply is called
- **Then** state should contain both resources as active
- **And** state should be written after each resource plus once for workers

### ✅ skips resources already active in state

- **Given** state already has the KV resource active
- **When** apply is called
- **Then** KV should not be recreated, D1 should be created

### ✅ throws on resource creation failure and preserves partial state

- **Given** D1 creation fails
- **When** apply is called
- **Then** the KV resource should still be persisted in state

### ✅ removes workers from state that are no longer declared in the manifest

- **Given** existing state containing a worker removed from config.workers
- **When** apply is run
- **Then** the stale worker should be removed from persisted state

### ✅ records worker names with stage suffix

- **Given** a config with one worker
- **When** apply is called
- **Then** the worker name should be stage-suffixed

## src/core/completions.test.ts

### generateCompletions

### ✅ zsh output contains compdef and command names

- **Given** zsh shell requested
- **Then** output contains compdef directive
- **And** output contains expected command names

### ✅ bash output contains complete -F and command names

- **Given** bash shell requested
- **Then** output contains complete -F directive
- **And** output contains expected command names

### ✅ fish output contains complete -c wd lines and command names

- **Given** fish shell requested
- **Then** output contains complete -c wd directive
- **And** output contains expected command names

## src/core/deploy.test.ts

### deploy

### ✅ deploys each worker from its own directory

- **Given** a worker with rendered config
- **When** deploy is called
- **Then** workers are deployed using wrangler

### ✅ blocks deploys when declared secrets are missing

- **Given** a stage with workers and declared secrets
- **When** deploy is called with missing secrets
- **Then** deploy is blocked with error

## src/core/destroy.test.ts

### destroy

### ✅ deletes workers that remain in state even if they were removed from the manifest

- **Given** a stage state containing a deployed worker that is no longer in config.workers
- **When** destroy is run against the stage
- **Then** the orphaned worker should still be deleted before state cleanup

### ✅ does not delete stage state when worker deletion fails

- **Given** a stage state containing a deployed worker
- **And** wrangler fails to delete that worker
- **When** destroy is run against the stage
- **Then** state cleanup should not run because teardown was incomplete

### ✅ does not delete stage state when queue consumer removal fails

- **Given** a stage state containing a queue and its consumer worker
- **When** destroy is run against the stage
- **Then** state cleanup should not run because consumer teardown was incomplete

### ✅ removes queue consumers for queues that remain only in state

- **Given** a stage state containing a managed queue and its consumer worker
- **And** the queue has already been removed from config.resources
- **When** destroy is run against the stage
- **Then** the queue consumer should still be detached before deletion proceeds

## src/core/dev-logs.test.ts

### createLogMultiplexer

### ✅ prefixes lines with the worker label

- **Given** a writer for apps/api
- **When** a line of output is written
- **Then** the output is prefixed with the worker label

### ✅ different workers get different prefixes

- **Given** writers for apps/api and apps/worker
- **When** each writes a line
- **Then** the prefixes are visually distinct

### ✅ multi-line output splits into individually prefixed lines

- **Given** a writer for apps/auth
- **When** multi-line data is written at once
- **Then** each line is emitted separately with the prefix

## src/core/dev-ports.test.ts

### assignPorts

### ✅ assigns unique ports >= basePort to all workers

- **Given** a config with three workers and basePort 8787
- **Then** every worker gets a unique port starting at 8787

### ✅ respects explicit port overrides

- **Given** a config with an explicit override for apps/api
- **Then** apps/api uses the overridden port 9000

### ✅ skips overridden ports when auto-assigning remaining workers

- **Given** apps/worker is overridden to 8788, basePort is 8787
- **Then** apps/worker uses 8788, other workers skip 8788

## src/core/dev.test.ts

### buildDevPlan

### ✅ creates plan for all workers in dependency order

- **Given** a config with api depending on worker
- **Then** plan contains both workers in dependency order (worker before api)

### ✅ each worker has a unique port assigned

- **Given** a config with two workers
- **Then** each worker has a port >= basePort and all ports are unique

### ✅ filter includes only target and transitive deps

- **Given** api -> worker -> auth, plus an unrelated worker
- **Then** plan only contains apps/api, apps/worker, apps/auth

### ✅ custom devArgs are included in worker args

- **Given** workerOptions with custom devArgs for apps/api
- **Then** the worker args include the custom devArgs

### ✅ throws when filter references an unknown worker

- **Given** a filter for a worker path that is not declared in the config
- **Then** building the plan fails fast instead of producing an empty dev session

### ✅ startDev preserves explicit planned ports instead of compacting them

- **Given** a plan with non-consecutive explicit worker ports
- **Then** the resolved dev ports still match the per-worker planned ports

## src/core/doctor.test.ts

### runDoctor

### ✅ all checks pass when system is healthy

- **Given** wrangler is installed, auth is valid, all worker paths exist, config is valid
- **Then** all checks have status pass
- **And** wrangler version is reported

### ✅ fails when wrangler is not installed

- **Given** wranglerVersion throws an error
- **Then** the wrangler installed check fails

### ✅ fails when worker paths are missing

- **Given** workerExists returns false for all paths
- **Then** worker path checks fail

### ✅ fails when config has errors

- **Given** configErrors contains validation errors
- **Then** a config error check is present with fail status

## src/core/drift.test.ts

### detectDrift

### ✅ reports in-sync when resources exist

- **Given** a state with KV, queue, and D1 resources
- **And** the Cloudflare API confirms they exist
- **When** drift detection runs
- **Then** all resources report in-sync

### ✅ reports orphaned when resource not found in API

- **Given** a state with KV and queue resources
- **And** the Cloudflare API returns empty results
- **When** drift detection runs
- **Then** all resources report orphaned

### ✅ does not report unsupported resource types as in-sync by default

- **Given** a state containing a D1 database
- **And** the live listing is empty
- **When** drift detection runs
- **Then** the D1 resource should not be treated as in-sync

### ✅ does not treat similarly named queues as exact matches

- **Given** a state containing a queue named outbox-staging
- **And** the live list only contains a different queue whose name contains that string
- **When** drift detection runs
- **Then** the queue should not be reported as in-sync

### ✅ does not treat similarly named D1 databases as exact matches

- **Given** a state containing a D1 database named payments-db-staging
- **And** the live list only contains a different database whose name contains that string
- **When** drift detection runs
- **Then** the D1 resource should not be reported as in-sync

## src/core/gc.test.ts

### gc

### ✅ destroys expired PR stages

- **Given** a list with one expired PR stage
- **Then** the expired PR stage is destroyed

### ✅ keeps non-expired PR stages

- **Given** a PR stage that is not yet expired
- **Then** the PR stage is kept

### ✅ never destroys protected stages

- **Given** a protected production stage
- **Then** the protected stage is not destroyed

### ✅ treats unmatched stages as protected

- **Given** a stage that doesn't match any pattern
- **Then** the stage is treated as protected

## src/core/graph-model.test.ts

### buildRichGraph

### ✅ creates nodes for all workers and resources

- **Given** a config with 3 workers and 4 resources
- **Then** graph has 7 nodes total

### ✅ sets worker node labels to the last path segment

- **Given** workers with path-based ids
- **Then** label is the last segment of the path

### ✅ creates service-binding edges with binding name as label

- **Given** apps/api has a service binding WORKFLOWS -> apps/batch-workflow
- **Then** a service-binding edge exists from api to batch-workflow with label WORKFLOWS

### ✅ creates producer edges for queue producer bindings

- **Given** apps/api binds to payment-outbox as a producer
- **Then** a producer edge exists from apps/api to payment-outbox

### ✅ creates consumer edges for queue consumer bindings

- **Given** apps/event-router binds to payment-outbox with consumer: true
- **Then** a consumer edge exists from apps/event-router to payment-outbox

### ✅ creates dead-letter edges for DLQ bindings

- **Given** payment-outbox-dlq has a deadLetterFor binding referencing payment-outbox
- **Then** a dead-letter edge exists from payment-outbox to payment-outbox-dlq

### ✅ creates binding edges for shared D1 resource bound to multiple workers

- **Given** payments-db is bound to both apps/api and apps/batch-workflow
- **Then** two binding edges exist from each worker to payments-db

### ✅ overlays state when provided

- **Given** a StageState with resource ids, statuses, and worker deployed names
- **Then** resource nodes have resourceId and status from state
- **And** worker nodes have deployedName from state

## src/core/graph.test.ts

### buildGraph

### ✅ creates worker nodes with service binding edges

- **Given** a config with apps/api binding to apps/worker
- **Then** api node depends on worker node

### ✅ creates resource nodes with DLQ edges

- **Given** a DLQ resource referencing a source queue
- **Then** DLQ node depends on source queue

### ✅ creates worker-to-resource edges from bindings

- **Given** a worker with a KV binding
- **Then** worker node depends on resource

### validateGraph

### ✅ passes for a valid graph

- **Given** a valid graph with proper dependencies
- **Then** validation passes without error

### ✅ throws for an unknown dependency target

- **Given** a graph referencing an unknown node
- **Then** validation throws an error

### topologicalSort

### ✅ sorts dependencies before dependents

- **Given** a graph where a depends on b
- **Then** b appears before a in sorted order

### ✅ detects a direct cycle (A -> B -> A)

- **Given** a graph with a direct cycle
- **Then** topologicalSort throws

### ✅ detects a transitive cycle (A -> B -> C -> A)

- **Given** a graph with a transitive cycle
- **Then** topologicalSort throws

### ✅ handles independent nodes

- **Given** nodes with no dependencies
- **Then** both nodes are included in result

### resolveDeployOrder

### ✅ uses explicit deployOrder when provided

- **Given** config with explicit deployOrder
- **Then** returns the explicit order

### ✅ infers order from service bindings when deployOrder is omitted

- **Given** config with service bindings but no explicit order
- **Then** worker appears before api (dependee before dependent)

### ✅ handles no service bindings — returns workers in declaration order

- **Given** workers with no bindings or order specified
- **Then** returns workers in declaration order

### ✅ throws on cyclic service bindings

- **Given** service bindings forming a cycle
- **Then** resolveDeployOrder throws

### ✅ throws on unknown service binding target

- **Given** service binding pointing to undeclared worker
- **Then** throws an error

### ✅ orders DLQ resource after its source queue

- **Given** a DLQ resource
- **Then** source queue appears before DLQ

### ✅ throws when explicit deployOrder violates service binding dependency

- **Given** explicit order that violates dependency
- **Then** throws an error

### ✅ accepts explicit deployOrder that respects dependencies

- **Given** explicit order that respects dependencies
- **Then** returns the explicit order

### ✅ throws when explicit deployOrder omits a declared worker

- **Given** an explicit deployOrder missing one declared worker
- **Then** resolveDeployOrder rejects the incomplete order

### ✅ throws when explicit deployOrder includes an undeclared worker

- **Given** an explicit deployOrder containing a worker not declared in config.workers
- **Then** resolveDeployOrder rejects the unknown worker

## src/core/impact.test.ts

### analyzeImpact

### ✅ returns upstream deps with sharedWith for a shared resource

- **Given** a graph where api and batch both bind payments-hyperdrive
- **Then** upstream includes payments-hyperdrive sharedWith apps/api
- **And** upstream includes cache-kv with empty sharedWith (exclusive to batch)

### ✅ returns downstream deps for workers that depend on target via service-binding

- **Given** apps/api has a service-binding to apps/batch-workflow
- **Then** downstream includes apps/api with relationship service-binding

### ✅ returns consequences for each downstream dep

- **Given** apps/api depends on apps/batch-workflow via service-binding
- **Then** consequences includes a message about apps/api losing service-binding

### ✅ returns consequences for unaffected workers

- **Given** apps/event-router has no dependency on apps/batch-workflow
- **Then** consequences includes unaffected message for event-router

### ✅ returns queue producer as upstream dep (not downstream)

- **Given** apps/api produces to payment-queue
- **Then** upstream includes payment-queue

### ✅ throws when targetId is not found in graph

- **Given** a graph without a node called apps/unknown
- **Then** analyzeImpact throws an error

### ✅ sets target to the targetId

- **Given** a valid target node
- **Then** result.target equals the targetId

## src/core/init.test.ts

### generateConfig

### ✅ discovers workers and generates resources, envs, and service bindings

- **Given** a monorepo with an API worker and a router worker
- **When** generateConfig scans the repo
- **Then** output contains worker paths and resource declarations
- **And** worker env exports include all bindings
- **And** config structure includes service bindings and stage rules

### ✅ skips ignored directories while scanning

- **Given** a repo with a valid worker and a wrangler.jsonc inside node_modules
- **When** generateConfig scans the repo
- **Then** only the real worker is discovered

### ✅ preserves both producer and consumer roles when one worker does both for the same queue

- **Given** a worker that both produces to and consumes from one queue
- **When** generateConfig scans the repo
- **Then** the generated queue binding should preserve both roles

## src/core/introspect.test.ts

### introspect

### ✅ disambiguates logical resource names that normalize to the same key

- **Given** live resources whose names collapse to the same logical key
- **When** introspect generates the config
- **Then** the generated config should not emit duplicate resource keys

### ✅ does not emit duplicate logical keys for bound resources with colliding normalized names

- **Given** two workers each bound to a KV namespace whose names normalize identically
- **When** introspect generates the config
- **Then** only one logical resource key should appear, with merged bindings

### ✅ reconstructs DLQ relationships from queue consumer metadata

- **Given** a queue with a consumer and a configured dead-letter queue in live account state
- **When** introspect generates config from the live account
- **Then** the dead-letter queue relationship should be preserved in the config

### ✅ keeps queue consumer workers declared when filtering by resource name

- **Given** a queue with a consumer worker discovered from resource metadata
- **When** introspect runs with a filter matching the queue
- **Then** the consumer worker should be in the workers array

### ✅ merges producer and consumer roles for the same worker on one queue

- **Given** a worker that both produces to and consumes from the same queue
- **When** introspect generates the config
- **Then** only one binding entry should exist for that worker, with both roles merged

### ✅ does not drop resources when different resource types normalize to the same logical key

- **Given** a KV namespace and a D1 database whose names normalize to the same key
- **When** introspect generates the config
- **Then** both resources should still be represented in the manifest

### ✅ keeps same-type merged bindings even when a cross-type collision forces disambiguation

- **Given** two KV namespaces and one D1 database that all normalize to the same base key
- **When** introspect generates disambiguated resource names
- **Then** the disambiguated KV resource should still include both worker bindings

### ✅ avoids collisions between disambiguated names and real resource names

- **Given** a cross-type collision whose disambiguated name matches a real resource name
- **When** introspect generates resource names
- **Then** it should not emit duplicate object keys after disambiguation

## src/core/jsonc-writer.test.ts

### updateJsonc

### ✅ adds a new key while preserving comments

- **Given** a JSONC string with a comment header
- **When** a new key is added via updates
- **Then** the result contains the new key
- **And** the comment is preserved in the output

### ✅ updates an existing key value

- **Given** a JSONC string with an existing key
- **When** the key is updated
- **Then** the key is updated and others are preserved

### ✅ adds nested objects for env sections

- **Given** a JSONC string with a top-level config
- **When** a nested env section is added
- **Then** the nested structure is present in the output

### ✅ handles trailing commas

- **Given** a JSONC string with trailing commas
- **When** parsed and updated
- **Then** trailing commas are removed and extra key is added

## src/core/managed.test.ts

### writeManagedBindings

### ✅ generates KV and D1 bindings with correct IDs

- **Given** a config with KV, D1, hyperdrive, and queue bindings for apps/api
- **Then** KV bindings include the correct ID
- **And** D1 bindings include the database_id and database_name
- **And** Hyperdrive bindings are included
- **And** Queue producer bindings are included
- **And** Service bindings map target worker to deployed name

### ✅ skips resources without observed IDs

- **Given** a state where cache-kv has no observed ID (missing)
- **Then** KV bindings are not generated for the missing resource
- **And** D1 bindings are still generated (has an ID)

## src/core/naming.test.ts

### resourceName

### ✅ appends stage to logical name

- **Given** a logical name 'cache-kv' and stage 'staging'
- **Then** returns 'cache-kv-staging'

### ✅ works with PR stages

- **Given** a logical name 'payment-outbox' and stage 'pr-123'
- **Then** returns 'payment-outbox-pr-123'

### workerName

### ✅ appends stage to base worker name

- **Given** a worker name 'payment-api' and stage 'staging'
- **Then** returns 'payment-api-staging'

### stageMatchesPattern

### ✅ matches exact names

- **Given** stage 'staging' and pattern 'staging'
- **Then** returns true

### ✅ matches glob patterns

- **Given** stage 'pr-123' and pattern 'pr-*'
- **Then** returns true
- **And** stage 'pr-456' and pattern 'pr-*'
- **And** returns true

### ✅ rejects non-matching patterns

- **Given** stage 'production' and pattern 'pr-*'
- **Then** returns false

### isStageProtected

### ✅ protects named stages

- **Given** stage 'production' with protection rules
- **Then** returns true (protected)
- **And** stage 'staging' with protection rules
- **And** returns true (protected)

### ✅ allows PR stages

- **Given** stage 'pr-123' matching 'pr-*' pattern
- **Then** returns false (not protected)

### ✅ defaults to protected for unknown stages

- **Given** stage 'unknown' with no matching rule
- **Then** returns true (protected by default)

### ✅ defaults to protected when no rules

- **Given** stage 'anything' with undefined rules
- **Then** returns true (protected by default)

## src/core/port-finder.test.ts

### findAvailablePorts

### ✅ returns the requested number of unique ports

- **Given** a request for 3 available ports starting at 19200
- **Then** 3 unique ports are returned, all >= 19200

### ✅ skips ports that are already in use

- **Given** port 19300 is occupied by another process
- **Then** the occupied port is skipped

### ✅ skips ports in the exclude set

- **Given** ports 19400 and 19401 are in the exclude set
- **Then** excluded ports are skipped even if they are free

## src/core/render.golden.test.ts

### golden: renderWranglerConfig

### ✅ renders API worker with correct KV ID, queue name, service binding, and no Hyperdrive placeholder

- **Given** an API worker config with KV, queue, service binding, and Hyperdrive
- **And** state contains provisioned resource IDs for staging
- **When** renderWranglerConfig is called for staging
- **Then** the worker name is stage-suffixed
- **And** KV ID is replaced from state
- **And** queue name is stage-suffixed
- **And** service binding target is stage-suffixed
- **And** Hyperdrive ID is replaced and localConnectionString removed
- **And** compatibility flags are preserved

### ✅ renders router worker with stage-suffixed queue names and DLQ

- **Given** a router worker config with queue consumers, producers, and a DLQ
- **When** renderWranglerConfig is called for staging
- **Then** the worker name is stage-suffixed
- **And** consumer queue name is stage-suffixed
- **And** DLQ is stage-suffixed
- **And** consumer settings are preserved from base config
- **And** producer queue name is also stage-suffixed

### ✅ renders for pr-123 stage with different suffixes

- **Given** a PR stage with pr-123 resource IDs and worker names
- **When** renderWranglerConfig is called for pr-123
- **Then** all names and IDs use the pr-123 suffix

### ✅ strips placeholder KV IDs from output

- **Given** a KV resource in state with no real ID
- **When** renderWranglerConfig is called
- **Then** the KV namespace is excluded from the rendered config

### ✅ renders routes with stage-specific patterns

- **Given** a config with route patterns containing a {stage} placeholder
- **When** renderWranglerConfig is called for staging
- **Then** the route pattern has {stage} replaced with the stage name

### ✅ renders routes for PR stages

- **Given** a config with route patterns containing a {stage} placeholder
- **And** a PR stage with pr-123 worker names
- **When** renderWranglerConfig is called for pr-123
- **Then** the route pattern uses the PR stage name

### ✅ strips placeholder Hyperdrive IDs from output

- **Given** a Hyperdrive resource in state with no real ID
- **When** renderWranglerConfig is called
- **Then** the Hyperdrive binding is excluded from the rendered config

### ✅ only rewrites the matching queue consumer when a worker consumes multiple queues

- **Given** a worker config with two independent queue consumers
- **When** renderWranglerConfig is called for the consumer worker
- **Then** only the bound consumer queue is stage-suffixed

### ✅ uses the queue name from state rather than recomputing it from the logical name

- **Given** a queue resource whose actual staged name differs from resourceName(logicalName, stage)
- **When** renderWranglerConfig is called for a producer bound to that queue
- **Then** the rendered producer should target the actual queue name from state

## src/core/render.test.ts

### renderWranglerConfig

### ✅ resolves the worker main entry from the repo root when provided

- **Given** a worker config with a relative main entry path
- **When** renderWranglerConfig is called with a repo root path
- **Then** it does not throw
- **And** main is resolved to an absolute path from the repo root

## src/core/secrets.test.ts

### secrets

### ✅ returns empty when all secrets are set

- **Given** state with all secrets set
- **Then** validation returns empty array

### ✅ returns missing secrets

- **Given** state with some secrets missing
- **Then** validation returns list of missing secrets

### ✅ returns all missing when no secrets in state

- **Given** state with no secrets recorded
- **Then** validation returns all declared secrets as missing

### ✅ checks secrets via wrangler and persists the result to state

- **Given** state with workers
- **And** wrangler returns one secret
- **Then** returns correct status for each secret
- **And** state is updated with secret status

### ✅ sets a secret through wrangler secret put

- **Given** worker name, secret name and value
- **When** setSecret is called
- **Then** wrangler secret put is executed

### ✅ syncs declared secrets from an env file and updates state

- **Given** an env file with AUTH_SECRET
- **And** state with workers
- **Then** secrets matching env file are set
- **And** state is updated with secret status

## src/core/stage-diff.test.ts

### diffStages

### ✅ sets stageA and stageB names on result

- **Given** two stage states named staging and production
- **Then** result.stageA is staging and result.stageB is production

### ✅ classifies shared resources with same type as same

- **Given** payments-db exists in both stages with same type d1
- **Then** payments-db has status same

### ✅ classifies a resource only in A as only-in-a

- **Given** staging-only-kv exists only in stageA
- **Then** staging-only-kv has status only-in-a

### ✅ classifies a resource only in B as only-in-b

- **Given** a stageB with a resource not in stageA
- **Then** prod-only-queue has status only-in-b

### ✅ classifies a resource with different type as different

- **Given** cache-kv has type kv in A but type d1 in B
- **Then** cache-kv has status different

### ✅ classifies shared workers as same

- **Given** apps/api exists in both stages
- **Then** apps/api worker has status same

### ✅ classifies a worker only in A as only-in-a

- **Given** apps/staging-only exists only in stageA
- **Then** apps/staging-only has status only-in-a

### ✅ reports secret differences — set in A, missing in B

- **Given** DB_PASSWORD is set in staging but missing in production
- **Then** a SecretDiff exists for apps/api DB_PASSWORD with inA=set and inB=missing

### ✅ does not report secrets that are identical in both stages

- **Given** API_KEY is set in both staging and production
- **Then** no SecretDiff for apps/api API_KEY

### ✅ reports a secret absent in A but set in B

- **Given** stageB has a secret not present in stageA's worker at all
- **Then** NEW_SECRET for apps/api has inA=absent and inB=set

## src/core/state.test.ts

### KvStateProvider

### ✅ reads JSON state from the KV values endpoint text body

- **Given** remote state stored as JSON text in Cloudflare KV
- **When** the provider reads a stage from remote state
- **Then** it should parse the JSON text body into stage state

## src/core/validate-config.test.ts

### validateConfig

### ✅ passes for a valid config

- **Given** a config where all references are valid and there are no cycles
- **Then** no errors are returned

### ✅ catches binding to a non-existent worker

- **Given** a resource that has a binding for a worker not in the workers list
- **Then** an error is returned about the unknown worker

### ✅ catches circular service bindings

- **Given** two workers that each bind to the other as a service
- **Then** a circular binding error is detected

### ✅ catches DLQ referencing a non-existent resource

- **Given** a queue resource with a deadLetterFor pointing to a non-existent resource
- **Then** an error about the unknown DLQ resource is returned

### ✅ catches service binding to a non-existent worker

- **Given** a service binding that targets a worker not in the workers list
- **Then** an error about the unknown target worker is returned

### ✅ catches DLQ referencing a resource that is not a queue

- **Given** a deadLetterFor reference that points at an existing KV resource instead of a queue
- **Then** an error is returned because deadLetterFor must target another queue

## src/core/verify.test.ts

### verify

### ✅ passes when everything is correct

- **Given** valid state with all resources and secrets
- **Then** verification passes

### ✅ fails when state is missing

- **Given** no state exists
- **Then** verification fails with state check

### ✅ fails when a secret is missing

- **Given** state with a missing secret
- **Then** verification fails on secret check

### ✅ fails when service binding target is missing from state

- **Given** state missing worker referenced in service binding
- **Then** verification fails on service binding check

### ✅ fails when state still contains workers removed from the manifest

- **Given** state containing an extra worker not declared in config.workers
- **When** verification runs
- **Then** verification should fail because state contains undeclared workers

## src/core/ci/check.test.ts

### postCheckRun

### ✅ posts a success check run when state exists

- **Given** a valid stage state and a GitHub provider
- **Then** a success check run is created via the provider

### ✅ posts a failure check run when state is null

- **Given** a null state (stage has not been deployed)
- **Then** a failure check run is created via the provider

## src/core/renderers/ascii.test.ts

### renderAscii

### ✅ includes worker names in the output

- **Given** a graph with two workers
- **Then** output contains both worker labels

### ✅ includes resource names in the output

- **Given** a graph with KV and D1 resources
- **Then** output contains resource names

### ✅ includes edge labels (binding names) in the output

- **Given** edges with binding name labels
- **Then** output contains the binding labels

### ✅ uses tree structure prefixes

- **Given** a multi-node graph
- **Then** output contains tree structure characters

### ✅ includes resource type labels

- **Given** a graph with kv and d1 resources
- **Then** output shows the resource type

### ✅ shows deployedName and resourceId when present in state-enriched nodes

- **Given** a graph with state-enriched nodes
- **Then** output shows deployed name and resource id

## src/core/renderers/dot.test.ts

### renderDot

### ✅ outputs a valid digraph block

- **Given** any graph
- **Then** output is a digraph block

### ✅ contains sanitized node IDs

- **Given** nodes with slashes and hyphens
- **Then** node IDs appear in the output sanitized

### ✅ assigns box shape to worker nodes

- **Given** worker nodes
- **Then** worker nodes have shape=box

### ✅ assigns cylinder shape to KV and D1 nodes

- **Given** kv and d1 nodes
- **Then** kv and d1 nodes have shape=cylinder

### ✅ assigns parallelogram shape to queue nodes

- **Given** a queue node
- **Then** queue nodes have shape=parallelogram

### ✅ assigns hexagon shape to hyperdrive nodes

- **Given** a hyperdrive node
- **Then** hyperdrive nodes have shape=hexagon

### ✅ includes edge labels

- **Given** edges with labels
- **Then** edge labels appear in the output

### ✅ renders dead-letter edges with style=dashed

- **Given** a dead-letter edge
- **Then** dead-letter edges have style=dashed

## src/core/renderers/json.test.ts

### renderJson

### ✅ returns a parseable JSON string

- **Given** a graph with nodes and edges
- **Then** the output is valid JSON

### ✅ parsed output contains nodes array

- **Given** a graph with two nodes
- **Then** parsed JSON has a nodes array

### ✅ parsed output contains edges array

- **Given** a graph with one edge
- **Then** parsed JSON has an edges array

### ✅ preserves all node fields

- **Given** a node with id, type, and label
- **Then** the node fields are preserved

### ✅ is pretty-printed with 2-space indentation

- **Given** any graph
- **Then** output is formatted with 2-space indentation

## src/core/renderers/mermaid.test.ts

### renderMermaid

### ✅ starts with 'graph TD'

- **Given** any graph
- **Then** output starts with graph TD

### ✅ renders workers with rounded box shape

- **Given** worker nodes
- **Then** workers use ([label]) shape

### ✅ renders KV and D1 nodes with cylinder shape

- **Given** kv and d1 nodes
- **Then** KV and D1 use [(label)] shape

### ✅ renders queue nodes with parallelogram shape

- **Given** a queue node
- **Then** queue uses [/label\] shape

### ✅ renders hyperdrive nodes with hexagon shape

- **Given** a hyperdrive node
- **Then** hyperdrive uses {{label}} shape

### ✅ uses --> for service-binding and producer edges

- **Given** service-binding and producer edges
- **Then** those edges use --> arrow with label

### ✅ uses -.-> for binding edges

- **Given** binding edges
- **Then** binding edges use -.->

### ✅ uses -. DLQ .-> for dead-letter edges

- **Given** a dead-letter edge
- **Then** dead-letter edge uses -. DLQ .-> syntax

### ✅ includes subgraphs grouping nodes by type

- **Given** nodes of multiple types
- **Then** output contains subgraph sections

### ✅ sanitizes node IDs with non-alphanumeric characters

- **Given** nodes with slashes and hyphens in IDs
- **Then** node IDs have non-alphanumeric chars replaced with underscores