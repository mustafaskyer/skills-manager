import { resolveConfig, DEFAULT_OUTPUT_PATH } from "./src/config";
import { collectProviderSkills } from "./src/catalog/SkillCatalog";
import { writeSkillsFileV1, watchSkillsFile } from "./src/catalog/SkillIndexWriter";
import {
  codexSkillFromMarkdown,
  codexSourceForSkill,
  defaultCodexRoots,
  isVisibleCodexSkill,
} from "./src/providers/codex/CodexProvider";
import {
  basename,
  dirname,
  homeDir,
  joinPath,
  normalizePath,
  type MetadataValue,
} from "./src/path-utils";
import { parseFrontmatter } from "./src/frontmatter";
import { runCli } from "./src/cli/main";

const RUNTIME_IS_WINDOWS =
  (Bun.env.OS ?? "").startsWith("Windows") || /^[A-Za-z]:[\\/]/.test(import.meta.dir);
const PATH_DELIMITER = RUNTIME_IS_WINDOWS ? ";" : ":";

type SkillSource = "codex" | "agents" | "plugin" | "custom" | "unknown";

type SkillSourceInfo = {
  kind: SkillSource;
  root: string | null;
  relativePath: string;
};

type LegacySkill = {
  ref: string;
  legacyRef?: string;
  provider?: string;
  providerLabel?: string;
  sourceType?: string;
  pluginId?: string | null;
  name: string;
  title: string;
  description: string;
  version: MetadataValue | null;
  allowedTools: MetadataValue | null;
  source: SkillSource;
  sourceRoot: string | null;
  relativePath: string;
  path: string;
  directory: string;
  metadata: Record<string, MetadataValue>;
};

type CollectOptions = {
  roots?: string[];
  homeDir?: string;
};

type WriteOptions = CollectOptions & {
  outputPath?: string;
};

type WatchOptions = WriteOptions & {
  intervalMs?: number;
};

type ParsedArgs = {
  help: boolean;
  watch: boolean;
  outputPath: string;
  roots: string[];
};

export { DEFAULT_OUTPUT_PATH, parseFrontmatter };

export function defaultRoots(baseHomeDir = homeDir()): string[] {
  return defaultCodexRoots(baseHomeDir);
}

export function isPublicSkillFile(filePath: string, baseHomeDir = homeDir()): boolean {
  return isVisibleCodexSkill(filePath, baseHomeDir);
}

export function sourceForSkill(
  skillFile: string,
  roots: string[],
  baseHomeDir = homeDir(),
): SkillSourceInfo {
  const source = codexSourceForSkill(skillFile, roots, baseHomeDir);
  return {
    kind: source.sourceType as SkillSource,
    root: source.sourceRoot,
    relativePath: source.relativePath,
  };
}

export function buildRef(skillFile: string, roots: string[], baseHomeDir = homeDir()): string {
  const source = codexSourceForSkill(skillFile, roots, baseHomeDir);
  const segments = source.relativePath.split("/");
  const skillName = segments.at(-2) || basename(dirname(skillFile));

  if (source.sourceType === "plugin" && source.pluginId) {
    return `plugin:${source.pluginId}:${skillName}`;
  }

  return `${source.sourceType}:${skillName}`;
}

export function skillFromMarkdown(
  skillFile: string,
  markdown: string,
  roots: string[],
  baseHomeDir = homeDir(),
): LegacySkill {
  const source = codexSourceForSkill(skillFile, roots, baseHomeDir);
  const normalizedPath = normalizePath(skillFile);
  const skill = codexSkillFromMarkdown(
    {
      provider: "codex",
      sourceRoot: source.sourceRoot,
      relativePath: source.relativePath,
      path: normalizedPath,
      directory: dirname(normalizedPath),
      sourceType: source.sourceType,
      pluginId: source.pluginId,
    },
    markdown,
  );

  return {
    ...skill,
    ref: skill.legacyRef,
    legacyRef: skill.legacyRef,
    provider: skill.provider,
    providerLabel: skill.providerLabel,
    sourceType: skill.sourceType,
    pluginId: skill.pluginId,
    source: skill.sourceType as SkillSource,
  };
}

export async function findSkillFiles(root: string, baseHomeDir = homeDir()): Promise<string[]> {
  const snapshot = await collectProviderSkills({
    homeDir: baseHomeDir,
    providers: ["codex"],
    rootsByProvider: { codex: [root] },
  });
  return snapshot.skills.map((skill) => skill.path);
}

export async function collectSkills({
  roots = defaultRoots(),
  homeDir: baseHomeDir = homeDir(),
}: CollectOptions = {}): Promise<LegacySkill[]> {
  const snapshot = await collectProviderSkills({
    homeDir: baseHomeDir,
    providers: ["codex"],
    rootsByProvider: { codex: roots },
  });

  return snapshot.skills.map((skill) => ({
    ...skill,
    ref: skill.legacyRef,
    source: skill.sourceType as SkillSource,
  }));
}

export async function writeSkillsFile({
  outputPath = DEFAULT_OUTPUT_PATH,
  roots = defaultRoots(),
  homeDir: baseHomeDir = homeDir(),
}: WriteOptions = {}) {
  return writeSkillsFileV1({
    outputPath,
    homeDir: baseHomeDir,
    providers: ["codex"],
    rootsByProvider: { codex: roots },
  });
}

export function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    help: false,
    watch: false,
    outputPath: Bun.env.SKILLS_MANAGER_OUTPUT || DEFAULT_OUTPUT_PATH,
    roots: Bun.env.SKILLS_MANAGER_ROOTS
      ? Bun.env.SKILLS_MANAGER_ROOTS.split(PATH_DELIMITER).filter(Boolean)
      : defaultRoots(),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }

    if (arg === "--watch" || arg === "-w") {
      args.watch = true;
      continue;
    }

    if (arg === "--output" || arg === "-o") {
      args.outputPath = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--root" || arg === "-r") {
      args.roots.push(argv[index + 1]);
      index += 1;
      continue;
    }
  }

  return args;
}

export function usage(): string {
  return `Usage:
  bun run index.ts [--watch] [--output <path>] [--root <path>]
  skillsmanager dev [--provider codex] [--root <path>] [--host 127.0.0.1] [--port 3737]
  skillsmanager uninstall <skill> [--provider codex] [--root <path>] [--yes]

Options:
  -w, --watch        Watch skill roots and rewrite the JSON on SKILL.md changes.
  -o, --output       Output JSON path. Defaults to ~/.skills-manager/skills.json.
  -r, --root         Add a skill root to scan. Can be passed more than once.
  -h, --help         Print this help text.

Environment:
  SKILLS_MANAGER_OUTPUT     Override the output path.
  SKILLS_MANAGER_ROOTS      Replace default roots, separated by the OS path delimiter.
  SKILLS_MANAGER_PROVIDERS  Enabled providers, separated by the OS path delimiter.
`;
}

export async function watchSkills({
  outputPath = DEFAULT_OUTPUT_PATH,
  roots = defaultRoots(),
  homeDir: baseHomeDir = homeDir(),
  intervalMs = 250,
}: WatchOptions = {}): Promise<() => void> {
  return watchSkillsFile({
    outputPath,
    homeDir: baseHomeDir,
    providers: ["codex"],
    rootsByProvider: { codex: roots },
    intervalMs,
  });
}

async function main(): Promise<void> {
  const argv = Bun.argv.slice(2);
  const [command] = argv;

  if (command === "dev" || command === "sync" || command === "watch" || command === "uninstall") {
    await import("./src/cli/main").then(({ main }) => main());
    return;
  }

  const args = parseArgs(argv);

  if (args.help) {
    console.log(usage());
    return;
  }

  const config = await resolveConfig({
    providers: ["codex"],
    roots: args.roots,
    outputPath: args.outputPath,
  });

  if (args.watch) {
    await watchSkills({
      outputPath: config.outputPath,
      roots: config.rootsByProvider.codex,
      homeDir: config.homeDir,
    });
    return;
  }

  const payload = await writeSkillsFile({
    outputPath: config.outputPath,
    roots: config.rootsByProvider.codex,
    homeDir: config.homeDir,
  });
  console.log(`Recorded ${payload.count} skills in ${config.outputPath}`);
}

if (import.meta.main) await main();

export { runCli };
