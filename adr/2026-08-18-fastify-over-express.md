# 2. Use Fastify instead of Express for the airgapped monitoring service

Date: 2026-08-18

## Status

Accepted

## Context

This service receives usage reports from self-hosted, airgapped n8n instances and aggregates them into a local SQLite database. A single deployment is expected to serve many instances — up to thousands. Crucially, **we do not operate this service**: our customers host it inside their own airgapped networks, on hardware they provision, with ops teams whose size and skill we cannot assume. Keeping the hosting footprint cheap and the operational story simple is therefore a product requirement, not an engineering preference.

That constraint changes what a framework choice means. In a service we run, throughput headroom is a nice-to-have, because we retain every remediation lever: we can observe the load, scale horizontally, add a cache, or put something in front of the origin. In an airgapped customer deployment we have none of those. We cannot see the customer's traffic, cannot hotfix their instance, and — decisively — cannot put a CDN or edge worker in front of it, because there is no reachable edge. We have a concrete in-house precedent for why this matters: our Express-based **license server** ran into load problems that were mitigated by deploying a Cloudflare Worker alongside it to absorb traffic. That mitigation is structurally unavailable to an airgapped service. Whatever capacity this service ships with is the capacity it has, permanently.

n8n core uses Express, so choosing anything else here is a deliberate divergence and needs justifying.

## Decision

We use Fastify, on the principle that when the faster option costs nothing at build time and remediation is impossible after deployment, the faster option is the correct default.

Fastify's advantage comes from `find-my-way` (radix-tree routing), `fast-json-stringify` (schema-compiled response serialization), and lower per-request overhead. Reported throughput:

| Scenario | Express | Fastify | Gap |
| --- | --- | --- | --- |
| Synthetic "hello world" JSON, best case | ~20,000 req/sec | ~114,000 req/sec | ~5.6x |
| Synthetic, commonly cited midpoint | ~25,000 req/sec | ~48,000–80,000 req/sec | ~2–3x |
| Real-world API (DB access + business logic) | ~10,000–15,000 req/sec | ~30,000+ req/sec | ~1.4–2x |

**The bottom row is the one to plan against.** Synthetic figures vary by more than 5x across published benchmarks depending on hardware, Node version, payload size and concurrency, and most sources — including the ones cited below — do not document their methodology well enough to reproduce. The defensible claim is therefore the conservative one: under a realistic workload that touches a database, Fastify reliably sustains roughly **twice** the request rate of Express on identical hardware, and that ratio is consistent across sources even where the headline numbers disagree.

Doubling the request ceiling per unit of hardware directly serves the hosting requirement: it lowers the floor of what a customer must provision, and it widens the margin before a deployment we cannot inspect becomes a support ticket we cannot reproduce. Fastify also gives us plugin encapsulation that suits the existing layout (`src/plugins/` autoloaded via `@fastify/autoload`; `@fastify/bearer-auth` registered inside the ingest route so auth scope follows registration rather than middleware ordering) and `fastify-cli` for the start/watch/dev setup — real conveniences, but not the basis of this decision.

To be explicit about what this decision is *not* based on: the expected steady-state load is low. Each instance reports once per day at a jittered `reportTime` (`HH:mm`, drawn once at startup and persisted under `features:centralMonitoring` in the instance's `settings` table), so 10,000 instances average ~0.12 req/sec, spread across 1,440 one-minute buckets. Express would serve that comfortably. The argument here is about the cost floor for the customer and the total absence of a remediation path, not about today's traffic.

**Alternatives considered:**

- *Express, for consistency with n8n core.* The main alternative, and the case for it is genuine: shared idioms and engineers who already know it. Rejected because the consistency benefit scales with how much is actually shared, and here that is nearly nothing — a standalone service, one write endpoint, its own deployment lifecycle, no shared middleware, no code moving between it and core. Against that, the license server is our own evidence of an Express service outgrowing its HTTP layer and needing infrastructure we cannot deploy here.
- *A minimal `node:http` handler with no framework.* Fastest possible ceiling, but rejected: the service still needs routing, auth, body parsing, validation, structured logging and graceful shutdown, and hand-rolling those is more code to own — and more to get wrong in an environment we cannot patch — than a well-maintained framework dependency.

## Consequences

- The customer's minimum viable hardware for this service is roughly halved relative to an Express implementation under realistic load, and the margin before capacity becomes a support problem is roughly doubled. Both matter more than usual because we cannot observe or remediate an airgapped deployment.
- Growth in the reporting model — more frequent reports, larger payloads, added operator query endpoints — can be absorbed without revisiting the HTTP layer or asking customers to re-provision.
- **The low-load analysis above depends on the `HH:mm` jitter remaining in place.** If jitter is removed, if `reportTime` gains a fixed default, or if instances retry failed reports without jittered backoff, arrivals can collapse toward the same minute and the profile becomes bursty rather than flat. The jitter is a load-bearing assumption of the capacity estimate, not an optimization; changes to it are changes to this service's load profile.
- We diverge from n8n core's framework. Engineers moving between the two carry no HTTP-layer muscle memory across, Express middleware is not directly reusable here, and libraries that ship Express-only integrations will need `@fastify/*` equivalents or adapters.
- We take on the `@fastify/*` ecosystem as a dependency surface. It is smaller and more centrally maintained than Express's — fewer abandoned packages, but fewer third-party options for anything niche.
- The performance claim above is inherited from third-party benchmarks, not measured on our workload. If capacity ever becomes contested in review, the honest resolution is to benchmark the actual ingest path (JSON parse → validate → one SQLite insert), where the write is a plausible bottleneck well before the router is.

Sources: [PkgPulse: Express vs Fastify 2026](https://www.pkgpulse.com/guides/express-vs-fastify-2026), [Better Stack: Express.js vs Fastify](https://betterstack.com/community/guides/scaling-nodejs/fastify-express/), [Michael Guay: Express vs Fastify performance benchmark](https://michaelguay.dev/express-vs-fastify-a-performance-benchmark-comparison/)
