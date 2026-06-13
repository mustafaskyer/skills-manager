# AGENTS.md

- Default to Bun and TypeScript for scripts and tests in this project. Do not add new CommonJS/`.js` entry points when `tsconfig.json` already covers the runtime code.
- Prefer Bun APIs (`Bun.Glob`, `Bun.file`, `Bun.write`, `Bun.sleep`, `Bun.$`) over `node:*` imports. Only introduce Node compatibility APIs after verifying Bun lacks the capability and documenting why.
- Keep path handling platform-aware. Tests should cover POSIX paths and Windows-style drive paths because this project intentionally avoids `node:path`.
- When changing skill discovery, verify against real `SKILL.md` files and tests. Public skills currently come from `~/.codex/skills`, `~/.agents/skills`, and `~/.codex/plugins/cache`; keep `~/.codex/skills/.system` excluded unless the user explicitly asks for system skills.
- Do not leave watch processes running after verification.

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
