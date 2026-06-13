# skills-manager

Indexes installed public Codex skills into:

```bash
~/.skills-manager/skills.json
```

## Usage

```bash
bun install
bun run skills:sync
```

Use watch mode to keep the index updated while adding or editing skills:

```bash
bun run skills:watch
```

Watch mode runs only while the command is active.

## Skill Roots

Default roots:

- `~/.codex/skills` excluding `~/.codex/skills/.system`
- `~/.agents/skills`
- `~/.codex/plugins/cache`

Override the output path or add roots:

```bash
SKILLS_MANAGER_OUTPUT=/tmp/skills.json bun run skills:sync
bun run index.ts --root /path/to/skills --output /tmp/skills.json
```

## Output

Each skill entry includes:

- `ref`
- `name`
- `title`
- `description`
- `version`
- `allowedTools`
- source metadata
- absolute file paths

Paths in refs and relative paths use forward slashes for stable output across macOS, Linux, and Windows-style paths.
