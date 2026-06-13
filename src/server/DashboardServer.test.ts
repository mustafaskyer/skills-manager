import { afterEach, beforeEach, expect, test } from "bun:test";

import { startDashboardServer } from "./DashboardServer";

let tempDir: string;

beforeEach(() => {
  tempDir = `/tmp/skills-manager-server-${crypto.randomUUID()}`;
});

afterEach(async () => {
  await Bun.$`rm -rf ${tempDir}`.quiet();
});

async function writeSkill(filePath: string, markdown: string): Promise<void> {
  await Bun.write(filePath, markdown);
}

function joinPath(...parts: string[]): string {
  return parts.join("/").replace(/\/+/g, "/");
}

async function freePort(): Promise<number> {
  const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
  const port = server.port ?? 0;
  await server.stop();
  return port;
}

test("dashboard server exposes v1 health providers skills and preview APIs", async () => {
  const homeDir = joinPath(tempDir, "home");
  const root = joinPath(homeDir, ".agents", "skills");
  const skillPath = joinPath(root, "agent-browser", "SKILL.md");
  await writeSkill(
    skillPath,
    `---
name: agent-browser
description: Browser automation.
---

# Browser Automation

Use this when a browser needs to be controlled.
`,
  );
  await writeSkill(
    joinPath(root, "agent-browser", "resources", "example.md"),
    `---
title: Example
---

# Example Resource
`,
  );
  await writeSkill(joinPath(root, "agent-browser", "notes.txt"), "plain notes");

  const port = await freePort();
  const server = await startDashboardServer({
    host: "127.0.0.1",
    port,
    homeDir,
    providers: ["codex"],
    rootsByProvider: { codex: [root] },
  });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    const health = await fetch(`${baseUrl}/api/v1/health`).then((response) => response.json());
    const providers = await fetch(`${baseUrl}/api/v1/providers`).then((response) => response.json());
    const skills = await fetch(`${baseUrl}/api/v1/skills`).then((response) => response.json());
    const preview = await fetch(
      `${baseUrl}/api/v1/skills/${encodeURIComponent("codex:agents:agent-browser")}`,
    ).then((response) => response.json());
    const filePreview = await fetch(
      `${baseUrl}/api/v1/skills/${encodeURIComponent("codex:agents:agent-browser")}/files`,
    ).then((response) => response.json());
    const textPreview = await fetch(
      `${baseUrl}/api/v1/skills/${encodeURIComponent("codex:agents:agent-browser")}/files?path=${encodeURIComponent("notes.txt")}`,
    ).then((response) => response.json());
    const stylesheet = await fetch(`${baseUrl}/styles.css`).then((response) => response.text());
    const skillRoute = await fetch(`${baseUrl}/skills/${encodeURIComponent("codex:agents:agent-browser")}`);
    const missingAsset = await fetch(`${baseUrl}/missing.js`);

    expect(health).toMatchObject({
      apiVersion: 1,
      status: "ok",
      providers: ["codex"],
      skillCount: 1,
      warningCount: 0,
    });
    expect(providers.providers[0]).toMatchObject({
      id: "codex",
      label: "Codex",
      enabled: true,
      roots: [root],
    });
    expect(skills).toMatchObject({
      apiVersion: 1,
      schemaVersion: 2,
      count: 1,
    });
    expect(skills.skills[0]).not.toHaveProperty("markdown");
    expect(preview).toMatchObject({
      apiVersion: 1,
      truncated: false,
      skill: { ref: "codex:agents:agent-browser", legacyRef: "agents:agent-browser" },
    });
    expect(preview.markdown).toContain("# Browser Automation");
    expect(preview.markdown).not.toContain("name: agent-browser");
    expect(filePreview).toMatchObject({
      apiVersion: 1,
      selectedPath: "SKILL.md",
      file: {
        path: "SKILL.md",
        kind: "markdown",
      },
    });
    expect(filePreview.file.content).toContain("# Browser Automation");
    expect(filePreview.file.content).not.toContain("name: agent-browser");
    expect(filePreview.tree).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "resources", type: "directory" }),
        expect.objectContaining({ path: "resources/example.md", type: "file" }),
        expect.objectContaining({ path: "notes.txt", type: "file" }),
      ]),
    );
    expect(textPreview).toMatchObject({
      file: {
        path: "notes.txt",
        kind: "text",
        content: "plain notes",
      },
    });
    expect(stylesheet).toContain(".ui-button");
    expect(stylesheet).toContain("sd-fadeIn");
    expect(stylesheet).toContain(".katex");
    expect(stylesheet).toContain("--color-sidebar");
    expect(stylesheet).not.toContain("#262720");
    expect(skillRoute.status).toBe(200);
    expect(await skillRoute.text()).toContain('<div id="root"></div>');
    expect(missingAsset.status).toBe(404);
  } finally {
    await server.stop();
  }

  const reused = Bun.serve({ hostname: "127.0.0.1", port, fetch: () => new Response("reused") });
  await reused.stop();
});

test("preview endpoint only reads catalog entries", async () => {
  const homeDir = joinPath(tempDir, "home");
  const root = joinPath(homeDir, ".agents", "skills");
  await writeSkill(
    joinPath(root, "agent-browser", "SKILL.md"),
    `---
name: agent-browser
description: Browser automation.
---

# Browser Automation
`,
  );

  const port = await freePort();
  const server = await startDashboardServer({
    host: "127.0.0.1",
    port,
    homeDir,
    providers: ["codex"],
    rootsByProvider: { codex: [root] },
  });

  try {
    const response = await fetch(
      `http://127.0.0.1:${port}/api/v1/skills/${encodeURIComponent("../../etc/passwd")}`,
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.warnings[0]).toMatchObject({
      code: "PreviewReadError",
      message: "Skill ref is not in the current catalog.",
    });
  } finally {
    await server.stop();
  }
});

test("skill file endpoint rejects traversal attempts and unknown refs", async () => {
  const homeDir = joinPath(tempDir, "home");
  const root = joinPath(homeDir, ".agents", "skills");
  await writeSkill(
    joinPath(root, "agent-browser", "SKILL.md"),
    `---
name: agent-browser
description: Browser automation.
---

# Browser Automation
`,
  );
  await writeSkill(joinPath(root, "outside.md"), "# Outside");

  const port = await freePort();
  const server = await startDashboardServer({
    host: "127.0.0.1",
    port,
    homeDir,
    providers: ["codex"],
    rootsByProvider: { codex: [root] },
  });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    const traversal = await fetch(
      `${baseUrl}/api/v1/skills/${encodeURIComponent("codex:agents:agent-browser")}/files?path=${encodeURIComponent("../outside.md")}`,
    );
    const traversalBody = await traversal.json();
    const unknown = await fetch(
      `${baseUrl}/api/v1/skills/${encodeURIComponent("codex:agents:missing")}/files`,
    );
    const unknownBody = await unknown.json();

    expect(traversal.status).toBe(400);
    expect(traversalBody.warnings[0]).toMatchObject({
      code: "PreviewReadError",
      message: "Requested file path must stay inside the skill directory.",
    });
    expect(unknown.status).toBe(404);
    expect(unknownBody.warnings[0]).toMatchObject({
      code: "PreviewReadError",
      message: "Skill ref is not in the current catalog.",
    });
  } finally {
    await server.stop();
  }
});

test("uninstall endpoint removes user skills and cleans matching lock entries", async () => {
  const homeDir = joinPath(tempDir, "home");
  const root = joinPath(homeDir, ".agents", "skills");
  const skillPath = joinPath(root, "agent-browser", "SKILL.md");
  const lockPath = joinPath(homeDir, ".agents", ".skill-lock.json");
  await writeSkill(
    skillPath,
    `---
name: agent-browser
description: Browser automation.
---

# Browser Automation
`,
  );
  await Bun.write(lockPath, `${JSON.stringify({
    version: 3,
    skills: {
      "agent-browser": { source: "owner/repo" },
      other: { source: "owner/repo" },
    },
  }, null, 2)}\n`);

  const port = await freePort();
  const server = await startDashboardServer({
    host: "127.0.0.1",
    port,
    homeDir,
    providers: ["codex"],
    rootsByProvider: { codex: [root] },
  });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    const response = await fetch(
      `${baseUrl}/api/v1/skills/${encodeURIComponent("codex:agents:agent-browser")}/uninstall`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmRef: "codex:agents:agent-browser" }),
      },
    );
    const body = await response.json();
    const skills = await fetch(`${baseUrl}/api/v1/skills`).then((nextResponse) => nextResponse.json());
    const lock = await Bun.file(lockPath).json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      apiVersion: 1,
      lockUpdated: true,
      removedPaths: [joinPath(root, "agent-browser")],
    });
    expect(body.steps.map((step: { status: string }) => step.status)).toEqual([
      "completed",
      "completed",
      "completed",
      "completed",
    ]);
    expect(await Bun.file(skillPath).exists()).toBe(false);
    expect(skills.count).toBe(0);
    expect(lock.skills).not.toHaveProperty("agent-browser");
    expect(lock.skills).toHaveProperty("other");
  } finally {
    await server.stop();
  }
});

test("uninstall endpoint rejects confirmation mismatches and plugin-cache skills", async () => {
  const homeDir = joinPath(tempDir, "home");
  const agentsRoot = joinPath(homeDir, ".agents", "skills");
  const pluginRoot = joinPath(homeDir, ".codex", "plugins", "cache");
  const userSkillPath = joinPath(agentsRoot, "agent-browser", "SKILL.md");
  const pluginSkillPath = joinPath(pluginRoot, "bundle", "1.0.0", "skills", "github", "SKILL.md");
  await writeSkill(
    userSkillPath,
    `---
name: agent-browser
description: Browser automation.
---

# Browser Automation
`,
  );
  await writeSkill(
    pluginSkillPath,
    `---
name: github
description: GitHub tools.
---

# GitHub
`,
  );

  const port = await freePort();
  const server = await startDashboardServer({
    host: "127.0.0.1",
    port,
    homeDir,
    providers: ["codex"],
    rootsByProvider: { codex: [agentsRoot, pluginRoot] },
  });

  try {
    const baseUrl = `http://127.0.0.1:${port}`;
    const mismatch = await fetch(
      `${baseUrl}/api/v1/skills/${encodeURIComponent("codex:agents:agent-browser")}/uninstall`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmRef: "agents:agent-browser" }),
      },
    );
    const mismatchBody = await mismatch.json();
    const plugin = await fetch(
      `${baseUrl}/api/v1/skills/${encodeURIComponent("codex:plugin:bundle/1.0.0:github")}/uninstall`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmRef: "codex:plugin:bundle/1.0.0:github" }),
      },
    );
    const pluginBody = await plugin.json();

    expect(mismatch.status).toBe(400);
    expect(mismatchBody.warnings[0]).toMatchObject({
      code: "SkillUninstallError",
      message: "Confirmation ref must match the provider-aware skill ref.",
    });
    expect(plugin.status).toBe(400);
    expect(pluginBody.warnings[0]).toMatchObject({
      code: "SkillUninstallError",
      message: "Plugin-cache skills are managed by plugin installation and cannot be uninstalled safely here.",
    });
    expect(await Bun.file(userSkillPath).exists()).toBe(true);
    expect(await Bun.file(pluginSkillPath).exists()).toBe(true);
  } finally {
    await server.stop();
  }
});
