# AGENTS.md

- Default to Bun and TypeScript for scripts and tests in this project. Do not add new CommonJS/`.js` entry points when `tsconfig.json` already covers the runtime code.
- Prefer Bun APIs (`Bun.Glob`, `Bun.file`, `Bun.write`, `Bun.sleep`, `Bun.$`) over `node:*` imports. Only introduce Node compatibility APIs after verifying Bun lacks the capability and documenting why.
- Keep path handling platform-aware. Tests should cover POSIX paths and Windows-style drive paths because this project intentionally avoids `node:path`.
- When changing skill discovery, verify against real `SKILL.md` files and tests. Public skills currently come from `~/.codex/skills`, `~/.agents/skills`, and `~/.codex/plugins/cache`; keep `~/.codex/skills/.system` excluded unless the user explicitly asks for system skills.
- Keep provider-specific path, exclusion, and parsing behavior inside provider modules. The catalog owns aggregation, validation, deterministic sorting, duplicate handling, and warnings; server/UI code must consume normalized fields only.
- Local `npx --no-install skillsmanager dev` works through the package `bin` after installing a packed/local package into a consumer project. Do not assume `npx skillsmanager` can resolve this private local package from the npm registry.
- `bunfig.toml` scopes direct `bun test` to `src` because vendored repositories under `repos/` contain their own test files. Use `bun run test` to run both `src` tests and the root `index.test.ts` compatibility suite.
- Tailwind v4 source CSS contains directives such as `@source` and `@theme`; do not serve it directly to the browser. The dashboard server compiles `src/ui/styles.css` through `@tailwindcss/cli` for `/styles.css`, and the source must include Streamdown/plugin package paths relative to `src/ui/styles.css`, plus `streamdown/styles.css` and `katex/dist/katex.min.css`, so markdown preview utilities, animations, and math styles are generated.
- Style Streamdown output through its `[data-streamdown="..."]` attributes. Avoid broad `.markdown-rendered pre` or `.markdown-rendered code` rules because Streamdown's code plugin renders nested `pre > code` inside its own code block component.
- For utility dashboards, avoid decorative generated-UI styling such as repeated sparkle glyphs, radial/grid backgrounds, oversized showcase cards, and heavy tinted shadows. Prefer dense, task-oriented shadcn-style patterns: neutral tokens, crisp borders, compact controls, readable rows, and clear workspace hierarchy.
- Keep long catalog pagination discoverable. When result lists extend past the first viewport, prefer a bottom sticky pagination rail with the result list scrolling above it, and verify it stays visible without covering row content.
- Keep catalog row metadata and actions in one scoped right-side column. Do not reuse detail-page grid-area styles for repeated row fields, because they can pull paths, badges, and arrows out of alignment.
- Catalog filters only affect the catalog list. When the dashboard is on a skill detail route, keep sidebar filter controls disabled and verify they are no longer exposed as clickable controls in browser snapshots.
- If the global `agent-browser` shim points at a missing pnpm package, use `npm exec --yes agent-browser -- <command>` for UI verification instead of abandoning browser checks.
- Do not leave watch processes running after verification.
- When updating README/product docs, verify app capabilities from source code and screenshots first. Clearly separate implemented behavior from roadmap-level management actions such as add, remove, enable, and disable.
- When adding README screenshots for a feature, verify the image file exists and place it near the matching feature narrative so future doc edits do not describe an unverified UI state.

## Vendored Repositories

This project keeps external reference repositories under `repos/`.

- Keep `repos/` ignored by Git. Do not track external repository contents unless the user explicitly asks for a tracked subtree.
- Do not use `git subtree` when the user asks for repository paths to be ignored; subtree-managed repositories are tracked by design.
- Use external repositories as read-only reference material when working with related libraries.
- Prefer examples and patterns from the vendored source code over generated guesses or web search results.
- Do not edit files under `repos/` unless explicitly asked.
- Do not import from `repos/`; application code should continue importing from normal package dependencies.




Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.
