# Repository Provider

Use repository-owned state in this order:

1. root and nested agent instructions;
2. locked delivery, architecture, security, and decision artifacts;
3. current code, tests, schemas, and configuration;
4. verification runs and pull-request evidence;
5. relevant Git history and issues.

Prefer the narrowest source that directly supports the claim. Record new
durable decisions in the existing artifact that owns them. Do not create a
second source of truth merely to simulate a memory database.

At completion, add a verified lesson to `DECISIONS.md` when it changes a binding
choice. Keep reusable skill candidates as non-executable entries in the
delivery or decision artifacts until a separately reviewed promotion.
