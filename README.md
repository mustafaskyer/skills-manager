# Codex Skills Manager

Visualize, search, and inspect the agent skills installed on your machine.

Codex Skills Manager gives you one local dashboard for the skills side of Codex: what is installed, where each skill came from, what it does, and what files belong to it. It is built for the moment when you know you added useful skills, but no longer remember their names, providers, plugin bundles, or exact paths.

The current app focuses on cataloging, filtering, previewing, and indexing skills. It is structured to become the control surface for add, remove, enable, and disable workflows without pushing provider-specific path rules into the UI.

## Screenshots

![Catalog view](screenshots/Screenshot%202026-06-13%20at%2010.27.43%E2%80%AFPM.png)

![Skill preview view](screenshots/Screenshot%202026-06-13%20at%2010.28.19%E2%80%AFPM.png)

## What It Does

- Discovers public Codex skills from `~/.codex/skills`, `~/.agents/skills`, and `~/.codex/plugins/cache`.
- Keeps system skills under `~/.codex/skills/.system` excluded by default.
- Shows installed skills in a dense dashboard with search, provider filters, source filters, plugin filters, counts, and warnings.
- Opens a skill detail page with metadata, copyable refs and paths, a file tree, markdown preview, text preview, Mermaid, code, math, and CJK rendering.
- Writes a v1-compatible JSON skill index for older integrations.
- Watches skill roots and rewrites the JSON index when `SKILL.md` files change.
- Keeps provider logic isolated so future providers can be added without changing catalog, server, or UI assumptions.

## Stack

- Runtime: Bun
- Language: TypeScript
- Server: `Bun.serve`
- CLI: Effect CLI
- UI: React 19
- Styling: Tailwind CSS v4 with shadcn-style primitives
- Markdown preview: Streamdown with code, Mermaid, math, and CJK plugins
- Icons: Lucide React
- Tests: `bun test`

## Quick Start

Clone the repository:

```bash
git clone git@github.com:mustafaskyer/skills-manager.git
cd skills-manager
```

Install dependencies:

```bash
bun install
```

Start the local dashboard:

```bash
bun run bin/skillsmanager.ts dev
```

Open the URL printed by the command. By default it is:

```text
http://127.0.0.1:3737
```

Use a different port when needed:

```bash
bun run bin/skillsmanager.ts dev --port 3738
```

## CLI

Run the dashboard:

```bash
skillsmanager dev --provider codex --root ./skills --host 127.0.0.1 --port 3737
```

Write the JSON index once:

```bash
skillsmanager sync --provider codex --root ./skills --output ~/.skills-manager/skills.json
```

Watch skill roots and keep the JSON index updated:

```bash
skillsmanager watch --provider codex --root ./skills --output ~/.skills-manager/skills.json
```

The server binds to `127.0.0.1` by default. Passing `--host 0.0.0.0` is an explicit opt-in.

## Local Packed Install

You can test the package bin from a consumer project:

```bash
npm pack
mkdir /tmp/skills-manager-consumer
cd /tmp/skills-manager-consumer
npm init -y
npm install /path/to/skills-manager-1.0.0.tgz
npx --no-install skillsmanager dev --port 3737
```

The package bin uses:

```bash
#!/usr/bin/env bun
```

Bun must be installed even when the command is launched through `npx`.

## Configuration

Create `skillsmanager.config.json` in the working directory to set defaults:

```json
{
  "providers": ["codex"],
  "roots": ["./skills"],
  "outputPath": "./skills.json",
  "host": "127.0.0.1",
  "port": 3737
}
```

Environment variables are also supported:

```bash
SKILLS_MANAGER_OUTPUT=~/.skills-manager/skills.json
SKILLS_MANAGER_ROOTS=~/.codex/skills:~/.agents/skills
SKILLS_MANAGER_PROVIDERS=codex
```

On Windows-style runtimes, list values use `;` instead of `:`.

## API

Dashboard APIs are versioned under `/api/v1`.

### `GET /api/v1/health`

```json
{
  "apiVersion": 1,
  "status": "ok",
  "version": "1.0.0",
  "providers": ["codex"],
  "skillCount": 1,
  "warningCount": 0
}
```

### `GET /api/v1/providers`

```json
{
  "apiVersion": 1,
  "providers": [
    {
      "id": "codex",
      "label": "Codex",
      "enabled": true,
      "roots": ["/Users/example/.agents/skills"],
      "warnings": []
    }
  ]
}
```

### `GET /api/v1/skills`

Returns catalog metadata only, not full markdown content.

### `GET /api/v1/skills/:encodedRef`

Returns the normalized skill entry and `SKILL.md` markdown preview content. Preview reads are resolved only through known catalog refs and are truncated at 256 KiB.

### `GET /api/v1/skills/:encodedRef/files?path=SKILL.md`

Returns a safe file preview from inside the selected skill directory, plus the file tree for that skill.

Warnings use this shape:

```ts
{
  code: string;
  provider?: string;
  ref?: string;
  path?: string;
  message: string;
}
```

Missing roots and malformed entries return partial results with warnings.

## Provider Model

The current provider is Codex. The provider boundary is designed so Claude, Cursor, Windsurf, and other providers can be added later without path logic leaking into the catalog, server, or UI.

Providers implement `SkillProvider` in `src/providers/types.ts`.

Provider responsibilities:

- Discover entries from provider-specific roots.
- Own provider-specific exclusion and visibility rules.
- Parse provider-specific files or directories into `NormalizedSkill`.
- Produce stable `legacyRef` and provider-aware `ref` values.
- Keep path semantics out of the catalog, server, and UI.

Register providers in `src/providers/registry.ts`. Adding a provider should require provider implementation, registration, fixtures/tests, and docs/config updates only.

Provider tests should cover default roots, custom roots, visible and excluded entries, malformed entries, refs, duplicate behavior, and path normalization.

## Compatibility

The legacy sync output remains v1-compatible:

- Default roots are `~/.codex/skills`, `~/.agents/skills`, and `~/.codex/plugins/cache`.
- `~/.codex/skills/.system/**/SKILL.md` is excluded.
- Existing refs remain available as `legacyRef`: `codex:<skill>`, `agents:<skill>`, `plugin:<plugin-id>:<skill>`, `custom:<skill>`, `unknown:<skill>`.
- Provider-aware API refs are additive: `ref = <provider>:<legacyRef>`.
- Existing imports from `index.ts` continue to work.

## Tests

Direct `bun test` is scoped to `src` through `bunfig.toml` so vendored repositories under `repos/` are not scanned.

Run the full project suite:

```bash
bun run test
```

Run the legacy compatibility test directly:

```bash
bun test ./index.test.ts
```
