import { afterEach, beforeEach, expect, test } from "bun:test";

let tempDir: string;

beforeEach(() => {
  tempDir = `/tmp/skills-manager-cli-${crypto.randomUUID()}`;
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

async function runSkillsManager(args: string[], homeDir: string) {
  const process = Bun.spawn({
    cmd: [Bun.argv[0], "run", "bin/skillsmanager.ts", ...args],
    cwd: joinPath(import.meta.dir, "..", ".."),
    env: {
      ...Bun.env,
      HOME: homeDir,
      PWD: tempDir,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  return { stdout, stderr, exitCode };
}

test("cli uninstall removes a skill by legacy ref with --yes", async () => {
  const homeDir = joinPath(tempDir, "home");
  const root = joinPath(homeDir, ".agents", "skills");
  const skillPath = joinPath(root, "cli-skill", "SKILL.md");
  await writeSkill(
    skillPath,
    `---
name: cli-skill
description: CLI skill.
---

# CLI Skill
`,
  );

  const result = await runSkillsManager([
    "uninstall",
    "agents:cli-skill",
    "--provider",
    "codex",
    "--root",
    root,
    "--yes",
  ], homeDir);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("Removed codex:agents:cli-skill");
  expect(await Bun.file(skillPath).exists()).toBe(false);
});

test("cli uninstall rejects ambiguous exact names and plugin-cache skills", async () => {
  const homeDir = joinPath(tempDir, "home");
  const codexRoot = joinPath(homeDir, ".codex", "skills");
  const agentsRoot = joinPath(homeDir, ".agents", "skills");
  const pluginRoot = joinPath(homeDir, ".codex", "plugins", "cache");
  const codexSkillPath = joinPath(codexRoot, "same-codex", "SKILL.md");
  const agentsSkillPath = joinPath(agentsRoot, "same-agents", "SKILL.md");
  const pluginSkillPath = joinPath(pluginRoot, "bundle", "1.0.0", "skills", "plugin-skill", "SKILL.md");
  await writeSkill(
    codexSkillPath,
    `---
name: same
description: Codex skill.
---

# Same
`,
  );
  await writeSkill(
    agentsSkillPath,
    `---
name: same
description: Agents skill.
---

# Same
`,
  );
  await writeSkill(
    pluginSkillPath,
    `---
name: plugin-skill
description: Plugin skill.
---

# Plugin Skill
`,
  );

  const ambiguous = await runSkillsManager([
    "uninstall",
    "same",
    "--provider",
    "codex",
    "--root",
    codexRoot,
    "--root",
    agentsRoot,
    "--yes",
  ], homeDir);
  const plugin = await runSkillsManager([
    "uninstall",
    "codex:plugin:bundle/1.0.0:plugin-skill",
    "--provider",
    "codex",
    "--root",
    pluginRoot,
    "--yes",
  ], homeDir);

  expect(ambiguous.exitCode).not.toBe(0);
  expect(`${ambiguous.stdout}${ambiguous.stderr}`).toContain("Ambiguous skill name");
  expect(plugin.exitCode).not.toBe(0);
  expect(`${plugin.stdout}${plugin.stderr}`).toContain("Plugin-cache skills are managed");
  expect(await Bun.file(codexSkillPath).exists()).toBe(true);
  expect(await Bun.file(agentsSkillPath).exists()).toBe(true);
  expect(await Bun.file(pluginSkillPath).exists()).toBe(true);
});
