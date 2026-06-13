import { afterEach, beforeEach, expect, test } from "bun:test";

import {
  collectSkills,
  isPublicSkillFile,
  parseArgs,
  parseFrontmatter,
  sourceForSkill,
  skillFromMarkdown,
  writeSkillsFile,
} from "./index";

let tempDir: string;

beforeEach(async () => {
  tempDir = `/tmp/skills-manager-${crypto.randomUUID()}`;
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

test("parses skill frontmatter and markdown fallback fields", () => {
  const markdown = `---
name: "agent-browser"
description: "Browser automation CLI for AI agents."
version: 1.0.0
allowed-tools: Bash(agent-browser:*)
---

# Browser Automation

Use this when a browser needs to be controlled.
`;

  const { data, body } = parseFrontmatter(markdown);
  const skill = skillFromMarkdown(
    "/tmp/home/.agents/skills/agent-browser/SKILL.md",
    markdown,
    ["/tmp/home/.agents/skills"],
    "/tmp/home",
  );

  expect(data.name).toBe("agent-browser");
  expect(data.description).toBe("Browser automation CLI for AI agents.");
  expect(body).toContain("# Browser Automation");
  expect(skill.ref).toBe("agents:agent-browser");
  expect(skill.title).toBe("Browser Automation");
  expect(skill.allowedTools).toBe("Bash(agent-browser:*)");
});

test("excludes system skills while keeping public codex skills", () => {
  expect(isPublicSkillFile("/tmp/home/.codex/skills/react-doctor/SKILL.md", "/tmp/home")).toBe(
    true,
  );
  expect(isPublicSkillFile("/tmp/home/.codex/skills/.system/openai-docs/SKILL.md", "/tmp/home")).toBe(
    false,
  );
});

test("collects public skills from codex, agents, and plugin roots", async () => {
  const homeDir = joinPath(tempDir, "home");
  const roots = [
    joinPath(homeDir, ".codex", "skills"),
    joinPath(homeDir, ".agents", "skills"),
    joinPath(homeDir, ".codex", "plugins", "cache"),
  ];

  await writeSkill(
    joinPath(roots[0], "react-doctor", "SKILL.md"),
    `---
name: react-doctor
description: Run after React changes.
---

# React Doctor
`,
  );
  await writeSkill(
    joinPath(roots[0], ".system", "openai-docs", "SKILL.md"),
    `---
name: openai-docs
description: System docs.
---

# OpenAI Docs
`,
  );
  await writeSkill(
    joinPath(roots[1], "agent-browser", "SKILL.md"),
    `---
name: agent-browser
description: Browser automation.
---

# Browser Automation
`,
  );
  await writeSkill(
    joinPath(roots[2], "openai-curated-remote", "github", "0.1.2", "skills", "github", "SKILL.md"),
    `---
name: github
description: Inspect repositories.
---

# GitHub
`,
  );

  const skills = await collectSkills({ roots, homeDir });

  expect(skills.map((skill) => skill.ref)).toEqual([
    "agents:agent-browser",
    "codex:react-doctor",
    "plugin:openai-curated-remote/github/0.1.2:github",
  ]);
});

test("writes skills manager json payload", async () => {
  const homeDir = joinPath(tempDir, "home");
  const root = joinPath(homeDir, ".codex", "skills");
  const outputPath = joinPath(homeDir, ".skills-manager", "skills.json");

  await writeSkill(
    joinPath(root, "react-doctor", "SKILL.md"),
    `---
name: react-doctor
description: Run after React changes.
---

# React Doctor
`,
  );

  const payload = await writeSkillsFile({ outputPath, roots: [root], homeDir });
  const persisted = await Bun.file(outputPath).json();

  expect(payload.count).toBe(1);
  expect(persisted.skills[0].ref).toBe("codex:react-doctor");
  expect(persisted.skills[0].path).toBe(joinPath(root, "react-doctor", "SKILL.md"));
});

test("parses help without enabling sync or watch mode", () => {
  const args = parseArgs(["--help"]);

  expect(args.help).toBe(true);
  expect(args.watch).toBe(false);
});

test("builds default roots for linux style home paths", () => {
  const homeDir = "/home/ada";
  const skill = skillFromMarkdown(
    "/home/ada/.codex/skills/react-doctor/SKILL.md",
    `---
name: react-doctor
description: React checks.
---

# React Doctor
`,
    [
      "/home/ada/.codex/skills",
      "/home/ada/.agents/skills",
      "/home/ada/.codex/plugins/cache",
    ],
    homeDir,
  );

  expect(skill.ref).toBe("codex:react-doctor");
  expect(skill.relativePath).toBe("react-doctor/SKILL.md");
  expect(isPublicSkillFile("/home/ada/.codex/skills/.system/openai-docs/SKILL.md", homeDir)).toBe(
    false,
  );
});

test("normalizes windows style skill paths for refs and public filtering", () => {
  const homeDir = "C:\\Users\\Ada";
  const roots = [
    "C:\\Users\\Ada\\.codex\\skills",
    "C:\\Users\\Ada\\.agents\\skills",
    "C:\\Users\\Ada\\.codex\\plugins\\cache",
  ];
  const pluginSkill =
    "C:\\Users\\Ada\\.codex\\plugins\\cache\\openai-curated-remote\\github\\0.1.2\\skills\\github\\SKILL.md";

  const source = sourceForSkill(pluginSkill, roots, homeDir);
  const skill = skillFromMarkdown(
    pluginSkill,
    `---
name: github
description: Inspect repositories.
---

# GitHub
`,
    roots,
    homeDir,
  );

  expect(source.kind).toBe("plugin");
  expect(source.relativePath).toBe("openai-curated-remote/github/0.1.2/skills/github/SKILL.md");
  expect(skill.ref).toBe("plugin:openai-curated-remote/github/0.1.2:github");
  expect(
    isPublicSkillFile("C:\\Users\\Ada\\.codex\\skills\\.system\\openai-docs\\SKILL.md", homeDir),
  ).toBe(false);
});
