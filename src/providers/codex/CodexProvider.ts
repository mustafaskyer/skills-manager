import { Context, Effect, Layer } from "effect";

import {
  SkillParseError,
  type NormalizedSkill,
  type SkillUninstallResult,
  type SkillUninstallStep,
  type SkillUninstallStepName,
  type SkillWarning,
} from "../../domain";
import { firstHeading, firstParagraph, parseFrontmatter } from "../../frontmatter";
import {
  basename,
  dirname,
  hasHiddenDirectory,
  isRelativeInside,
  joinPath,
  normalizePath,
  relativePath,
  rootExists,
  SKILL_FILE,
} from "../../path-utils";
import type { ProviderContext, ProviderDiscovery, ProviderSkillEntry, SkillProvider } from "../types";

export function defaultCodexRoots(homeDir: string): string[] {
  return [
    joinPath(homeDir, ".codex", "skills"),
    joinPath(homeDir, ".agents", "skills"),
    joinPath(homeDir, ".codex", "plugins", "cache"),
  ];
}

export function isVisibleCodexSkill(filePath: string, homeDir: string): boolean {
  const normalized = normalizePath(filePath);
  const relativeToCodexSkills = relativePath(joinPath(homeDir, ".codex", "skills"), normalized);

  if (isRelativeInside(relativeToCodexSkills)) {
    const [firstSegment] = relativeToCodexSkills.split("/");
    return firstSegment !== ".system";
  }

  return true;
}

export function codexSourceForSkill(
  skillFile: string,
  roots: readonly string[],
  homeDir: string,
): {
  sourceType: string;
  sourceRoot: string | null;
  relativePath: string;
  pluginId: string | null;
} {
  const normalized = normalizePath(skillFile);
  const matchingRoot = roots.map(normalizePath).find((root) => {
    const relative = relativePath(root, normalized);
    return isRelativeInside(relative);
  });

  if (!matchingRoot) {
    return {
      sourceType: "unknown",
      sourceRoot: null,
      relativePath: basename(skillFile),
      pluginId: null,
    };
  }

  const skillRelativePath = relativePath(matchingRoot, normalized);
  const codexSkillsRoot = joinPath(homeDir, ".codex", "skills");
  const agentsSkillsRoot = joinPath(homeDir, ".agents", "skills");
  const pluginCacheRoot = joinPath(homeDir, ".codex", "plugins", "cache");

  if (matchingRoot === normalizePath(codexSkillsRoot)) {
    return { sourceType: "codex", sourceRoot: matchingRoot, relativePath: skillRelativePath, pluginId: null };
  }

  if (matchingRoot === normalizePath(agentsSkillsRoot)) {
    return { sourceType: "agents", sourceRoot: matchingRoot, relativePath: skillRelativePath, pluginId: null };
  }

  if (matchingRoot === normalizePath(pluginCacheRoot)) {
    const segments = skillRelativePath.split("/");
    const skillsIndex = segments.lastIndexOf("skills");
    const pluginId =
      skillsIndex > 0 ? segments.slice(0, skillsIndex).join("/") : segments.slice(0, -2).join("/");
    return { sourceType: "plugin", sourceRoot: matchingRoot, relativePath: skillRelativePath, pluginId };
  }

  return { sourceType: "custom", sourceRoot: matchingRoot, relativePath: skillRelativePath, pluginId: null };
}

function legacyRefForEntry(entry: ProviderSkillEntry): string {
  const skillName = entry.relativePath.split("/").at(-2) || basename(dirname(entry.path));
  if (entry.sourceType === "plugin" && entry.pluginId) {
    return `plugin:${entry.pluginId}:${skillName}`;
  }
  return `${entry.sourceType}:${skillName}`;
}

function uninstallSteps(
  activeName?: SkillUninstallStepName,
  failedName?: SkillUninstallStepName,
  completedNames: readonly SkillUninstallStepName[] = [],
): SkillUninstallStep[] {
  const names: SkillUninstallStepName[] = ["locating repo", "removing", "checking", "removed"];
  return names.map((name) => ({
    name,
    status: failedName === name
      ? "failed"
      : completedNames.includes(name)
        ? "completed"
        : activeName === name
          ? "running"
          : "pending",
    message: name,
  }));
}

function uninstallWarning(skill: NormalizedSkill, message: string): SkillWarning {
  return {
    code: "SkillUninstallError",
    provider: skill.provider,
    ref: skill.ref,
    path: skill.directory,
    message,
  };
}

function skillLockPath(homeDir: string): string {
  return joinPath(homeDir, ".agents", ".skill-lock.json");
}

async function removeSkillFromLock(homeDir: string, skillName: string): Promise<boolean> {
  const lockPath = skillLockPath(homeDir);
  const file = Bun.file(lockPath);
  if (!(await file.exists())) return false;

  const raw = await file.text();
  const parsed = JSON.parse(raw) as {
    skills?: Record<string, unknown>;
  };
  if (!parsed.skills || !(skillName in parsed.skills)) return false;

  delete parsed.skills[skillName];
  await Bun.write(lockPath, `${JSON.stringify(parsed, null, 2)}\n`);
  return true;
}

async function fileExists(path: string): Promise<boolean> {
  return Bun.file(path).exists();
}

function matchingSourceRoot(skill: NormalizedSkill, context: ProviderContext): string | null {
  const roots = (context.roots && context.roots.length > 0
    ? context.roots
    : defaultCodexRoots(context.homeDir)).map(normalizePath);
  const sourceRoot = skill.sourceRoot ? normalizePath(skill.sourceRoot) : null;
  if (!sourceRoot) return null;
  if (!roots.includes(sourceRoot)) return null;

  const relative = relativePath(sourceRoot, skill.directory);
  if (!isRelativeInside(relative)) return null;
  if (normalizePath(skill.directory) === sourceRoot) return null;
  return sourceRoot;
}

export async function uninstallCodexSkill(
  skill: NormalizedSkill,
  context: ProviderContext,
): Promise<SkillUninstallResult> {
  const completed: SkillUninstallStepName[] = [];

  const fail = (step: SkillUninstallStepName, message: string): SkillUninstallResult => ({
    apiVersion: 1,
    skill,
    steps: uninstallSteps(undefined, step, completed),
    removedPaths: [],
    lockUpdated: false,
    warnings: [uninstallWarning(skill, message)],
  });

  if (skill.provider !== "codex") {
    return fail("locating repo", `Provider cannot uninstall this skill: ${skill.provider}`);
  }

  if (skill.sourceType === "plugin") {
    return fail(
      "locating repo",
      "Plugin-cache skills are managed by plugin installation and cannot be uninstalled safely here.",
    );
  }

  const sourceRoot = matchingSourceRoot(skill, context);
  if (!sourceRoot) {
    return fail("locating repo", "Skill directory is not inside an enabled source root.");
  }

  const skillFile = joinPath(skill.directory, SKILL_FILE);
  if (!(await fileExists(skillFile))) {
    return fail("locating repo", "Skill directory does not contain SKILL.md.");
  }

  completed.push("locating repo");

  try {
    await Bun.$`rm -rf ${skill.directory}`.quiet();
  } catch (error) {
    return fail("removing", error instanceof Error ? error.message : String(error));
  }

  completed.push("removing");

  if (await fileExists(skillFile) || await fileExists(skill.directory)) {
    return fail("checking", "Skill directory still exists after removal.");
  }

  completed.push("checking");
  completed.push("removed");

  const lockUpdated = await removeSkillFromLock(context.homeDir, skill.name).catch(() => false);

  return {
    apiVersion: 1,
    skill,
    steps: uninstallSteps(undefined, undefined, completed),
    removedPaths: [skill.directory],
    lockUpdated,
    warnings: [],
  };
}

export function codexSkillFromMarkdown(
  entry: ProviderSkillEntry,
  markdown: string,
): NormalizedSkill {
  const { data, body } = parseFrontmatter(markdown);
  const fallbackName = basename(entry.directory);
  const name = typeof data.name === "string" && data.name ? data.name : fallbackName;
  const legacyRef = entry.sourceType === "plugin" && entry.pluginId
    ? `plugin:${entry.pluginId}:${name}`
    : `${entry.sourceType}:${name}`;

  return {
    ref: `codex:${legacyRef}`,
    legacyRef,
    provider: "codex",
    providerLabel: "Codex",
    sourceType: entry.sourceType,
    name,
    title: firstHeading(body) || name,
    description:
      typeof data.description === "string" && data.description ? data.description : firstParagraph(body),
    version: data.version || null,
    allowedTools: data["allowed-tools"] || null,
    sourceRoot: entry.sourceRoot,
    pluginId: entry.pluginId,
    relativePath: entry.relativePath,
    path: normalizePath(entry.path),
    directory: normalizePath(entry.directory),
    metadata: data,
  };
}

async function findSkillEntries(root: string, roots: readonly string[], homeDir: string): Promise<ProviderSkillEntry[]> {
  const entries: ProviderSkillEntry[] = [];
  const glob = new Bun.Glob(`**/${SKILL_FILE}`);

  for await (const skillFile of glob.scan({ cwd: root, absolute: true, dot: true })) {
    const skillRelativePath = relativePath(root, skillFile);

    if (hasHiddenDirectory(skillRelativePath) || !isVisibleCodexSkill(skillFile, homeDir)) {
      continue;
    }

    const source = codexSourceForSkill(skillFile, roots, homeDir);
    entries.push({
      provider: "codex",
      sourceRoot: source.sourceRoot,
      relativePath: source.relativePath,
      path: normalizePath(skillFile),
      directory: dirname(skillFile),
      sourceType: source.sourceType,
      pluginId: source.pluginId,
    });
  }

  return entries;
}

export const CodexProvider: SkillProvider = {
  id: "codex",
  label: "Codex",
  defaultRoots: defaultCodexRoots,
  discover: (context) =>
    Effect.promise(async (): Promise<ProviderDiscovery> => {
      const roots = (context.roots && context.roots.length > 0
        ? [...context.roots]
        : defaultCodexRoots(context.homeDir)).map(normalizePath);
      const warnings: SkillWarning[] = [];
      const entries: ProviderSkillEntry[] = [];

      for (const root of roots) {
        if (!(await rootExists(root))) {
          warnings.push({
            code: "ProviderRootMissing",
            provider: "codex",
            path: root,
            message: `Provider root does not exist: ${root}`,
          });
          continue;
        }

        entries.push(...await findSkillEntries(root, roots, context.homeDir));
      }

      return {
        roots,
        warnings,
        entries: entries.sort((left, right) => legacyRefForEntry(left).localeCompare(legacyRefForEntry(right))),
      };
    }),
  parse: (entry) =>
    Effect.tryPromise({
      try: async () => codexSkillFromMarkdown(entry, await Bun.file(entry.path).text()),
      catch: (cause) =>
        new SkillParseError({
          provider: "codex",
          path: entry.path,
          message: cause instanceof Error ? cause.message : String(cause),
        }),
    }),
  uninstall: (skill, context) => Effect.promise(() => uninstallCodexSkill(skill, context)),
};

export class CodexProviderService extends Context.Service<CodexProviderService, SkillProvider>()(
  "skills-manager/providers/CodexProvider",
) {
  static readonly layer = Layer.succeed(CodexProviderService, CodexProviderService.of(CodexProvider));
}
