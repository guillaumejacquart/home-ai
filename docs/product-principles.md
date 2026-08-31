# Product principles (home-ai)

Why this project exists, what belongs in the platform, and what belongs in generated apps. Read this before adding a feature — it should prevent most debates.

> Decided 2026-08 — see conversation that led here (generic vs native, todo list question).

## Purpose

home-ai is a **self-hostable personal app factory**.

- For the family: the place where their apps come from. They live at `/a/<slug>`, generated from a prompt.
- For the geek who installs it: the factory itself is the product. The pitch is "your data stays on your server; the AI builds whatever your household needs."

Everything the family actually *uses* should live at `/a/<slug>`, generated. The platform only does three things: a **factory** (prompt → live app), a **trustworthy floor** (storage, execution, versions, access), and **agents** (assistant, MCP, scripts) that act on the same data.

## What goes native vs what stays an app

The axis is not "generic vs specific" — it is **capability vs use case**.

| Make it native (capability) | Keep it an app (use case) |
|---|---|
| Many apps would otherwise rebuild it badly | A domain: todos, recipes, budget, birthdays |
| Correctness must be guaranteed by the platform (transactions, conflicts, auth, sandbox) | A UI taste: list vs board, drag-and-drop, colour theme |
| A shared, consistent rule (one visibility model, one auth guard) | A household workflow |

Every native thing shipped so far is a capability: `app_storage` + row ops, `global_storage`, dashboards, scripts, connections/registry, MCP+tokens, assistant, manifests, Data Studio. Nothing vertical exists in the platform — and that is intentional.

A native capability makes the platform **more** generic. A native use-case feature makes it less.

## The decision rule

Before adding something native, all of these must be false — otherwise it is an app:

1. Is it a **domain** (todos, budgets, etc.), a **UI preference** (kanban, calendar view), or a **workflow** (weekly review)? → app. Then ask: which capability gap made it painful? Fix that gap, regenerate.
2. If instead any of these are true, it is a candidate for native work:
   - Many apps would each rebuild the same thing worse (storage, connections, composition).
   - Correctness/concurrency/security must be **guaranteed**, not hoped for (atomic row ops, `baseUpdatedAt` conflicts, CSP/SSRF, ownership checks).
   - The rule must be **shared and consistent** (visibility `private`/`family`, `requireUser`, `can()`).
   - It is a **connection point** in or out (connections, MCP/REST, dashboards, manifests).

The slogan: **native = capability, app = product.**

## Native lanes

Spend native time only in these lanes (and the loop itself):

- **Trust** — storage correctness, transactions, conflicts, versions/rollback, sandbox.
- **Sharing** — visibility, ownership, RBAC.
- **Reach** — connections registry, `homeSDK`, MCP/REST + tokens, dashboards, manifests.
- **The loop** — generation quality (planner/coder, truncation guard, storage guard, iteration).

Anything else is an app until proven otherwise.

## The flywheel (how the three motivations fit together)

Product work, capability work, and loop work are not competing — they are a flywheel:

> **family product → friction log → capability fix → better loop → next product is cheaper → repeat**

Each turn makes the next app faster to build and more trustworthy to live in. The practical method is dogfooding: generate the app, **live in it for real for two weeks**, log every friction, and only then decide which friction deserves native work. If three different apps hit the same wall, the wall goes native.

## Templates — the one planned exception that is still a capability

A fresh install with zero apps looks dead — the "empty factory" problem. For the family, and especially for other self-hosters, the fix is **templates**: a handful of polished generated apps shipped as install sources.

- Templates are **files in the repo** (`templates/<slug>/{template.json, app.html}`), not DB rows (apps require an `ownerId`).
- Installing a template is `createApp` + `createVersion` (HTML + manifest) + seeding declared storage keys — an installed app is then a normal user-owned app.
- No curated/pinned protection in v1. Template re-sync and "protected app" are a future lane, only when a real family-critical app earns it.
- The todo app (list + board) is the first template and the pilot of the flywheel.

## How to argue for a native addition

Bring evidence from the flywheel: "we generated <X> and <Y> and <Z>, they all needed <capability>, here is the friction log." A single app's need is never enough. Update this doc when the argument succeeds, in the same change that ships the capability (AGENTS.md rule).
