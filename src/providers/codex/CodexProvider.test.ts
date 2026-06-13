import { afterEach, beforeEach, expect, test } from "bun:test";

import { collectProviderSkills } from "../../catalog/SkillCatalog";
import { defaultCodexRoots } from "./CodexProvider";

let tempDir: string;

beforeEach(() => {
  tempDir = `/tmp/skills-manager-codex-${crypto.randomUUID()}`;
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

test("codex provider preserves existing roots and legacy refs while adding provider-aware refs", async () => {
  const homeDir = joinPath(tempDir, "home");
  const roots = defaultCodexRoots(homeDir);

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
allowed-tools: Bash(gh:*)
---

# GitHub
`,
  );

  const payload = await collectProviderSkills({ homeDir, providers: ["codex"] });

  expect(payload.warnings).toEqual([]);
  expect(payload.skills.map((skill) => skill.legacyRef)).toEqual([
    "agents:agent-browser",
    "codex:react-doctor",
    "plugin:openai-curated-remote/github/0.1.2:github",
  ]);
  expect(payload.skills.map((skill) => skill.ref)).toEqual([
    "codex:agents:agent-browser",
    "codex:codex:react-doctor",
    "codex:plugin:openai-curated-remote/github/0.1.2:github",
  ]);
  expect(payload.skills.map((skill) => skill.provider)).toEqual(["codex", "codex", "codex"]);
  expect(payload.skills.map((skill) => skill.sourceType)).toEqual(["agents", "codex", "plugin"]);
  expect(payload.skills.at(2)?.pluginId).toBe("openai-curated-remote/github/0.1.2");
});

test("codex provider reports missing roots as warnings and returns partial results", async () => {
  const homeDir = joinPath(tempDir, "home");
  const codexRoot = joinPath(homeDir, ".codex", "skills");

  await writeSkill(
    joinPath(codexRoot, "react-doctor", "SKILL.md"),
    `---
name: react-doctor
description: React checks.
---

# React Doctor
`,
  );

  const payload = await collectProviderSkills({
    homeDir,
    providers: ["codex"],
    rootsByProvider: { codex: [codexRoot, joinPath(homeDir, "missing-root")] },
  });

  expect(payload.count).toBe(1);
  expect(payload.skills[0].legacyRef).toBe("codex:react-doctor");
  expect(payload.warnings).toEqual([
    {
      code: "ProviderRootMissing",
      provider: "codex",
      path: joinPath(homeDir, "missing-root"),
      message: `Provider root does not exist: ${joinPath(homeDir, "missing-root")}`,
    },
  ]);
});

test("catalog skips duplicate provider-aware refs deterministically", async () => {
  const homeDir = joinPath(tempDir, "home");
  const roots = defaultCodexRoots(homeDir);

  await writeSkill(
    joinPath(roots[0], "same", "SKILL.md"),
    `---
name: same
description: First skill.
---

# Same
`,
  );
  await writeSkill(
    joinPath(roots[0], "other-folder", "SKILL.md"),
    `---
name: same
description: Duplicate name.
---

# Same Duplicate
`,
  );

  const payload = await collectProviderSkills({ homeDir, providers: ["codex"] });

  expect(payload.skills).toEqual([]);
  expect(payload.warnings).toContainEqual({
    code: "DuplicateSkillRef",
    provider: "codex",
    ref: "codex:codex:same",
    message: "Duplicate skill ref skipped: codex:codex:same",
  });
});
