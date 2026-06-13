const SKILL_FILE = "SKILL.md";
const RUNTIME_IS_WINDOWS =
  (Bun.env.OS ?? "").startsWith("Windows") || /^[A-Za-z]:[\\/]/.test(import.meta.dir);
const PATH_DELIMITER = RUNTIME_IS_WINDOWS ? ";" : ":";

type MetadataValue = string | boolean | MetadataValue[];
type SkillSource = "codex" | "agents" | "plugin" | "custom" | "unknown";

type SkillSourceInfo = {
  kind: SkillSource;
  root: string | null;
  relativePath: string;
};

type Skill = {
  ref: string;
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

type SkillsPayload = {
  schemaVersion: 1;
  generatedAt: string;
  roots: string[];
  count: number;
  skills: Skill[];
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

function homeDir(): string {
  return Bun.env.HOME || Bun.env.USERPROFILE || "";
}

function isAbsolutePath(filePath: string): boolean {
  return filePath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(filePath);
}

function splitPath(filePath: string): string[] {
  return filePath.split(/[\\/]+/).filter(Boolean);
}

function normalizePath(filePath: string): string {
  const raw = isAbsolutePath(filePath) ? filePath : `${Bun.env.PWD || import.meta.dir}/${filePath}`;
  const drive = raw.match(/^[A-Za-z]:/)?.[0] ?? "";
  const withoutDrive = drive ? raw.slice(drive.length) : raw;
  const absolutePrefix = drive ? `${drive}/` : withoutDrive.startsWith("/") ? "/" : "";
  const segments: string[] = [];

  for (const segment of splitPath(withoutDrive)) {
    if (segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  return `${absolutePrefix}${segments.join("/")}` || absolutePrefix || ".";
}

function joinPath(...parts: string[]): string {
  const presentParts = parts.filter(Boolean);
  if (presentParts.length === 0) return ".";

  let firstAbsoluteIndex = -1;
  for (let index = presentParts.length - 1; index >= 0; index -= 1) {
    if (isAbsolutePath(presentParts[index])) {
      firstAbsoluteIndex = index;
      break;
    }
  }

  const relevantParts =
    firstAbsoluteIndex === -1 ? presentParts : presentParts.slice(firstAbsoluteIndex);

  return normalizePath(relevantParts.join("/"));
}

function relativePath(from: string, to: string): string {
  const fromSegments = splitPath(normalizePath(from));
  const toSegments = splitPath(normalizePath(to));
  let commonLength = 0;

  while (
    commonLength < fromSegments.length &&
    commonLength < toSegments.length &&
    fromSegments[commonLength] === toSegments[commonLength]
  ) {
    commonLength += 1;
  }

  return [
    ...Array.from({ length: fromSegments.length - commonLength }, () => ".."),
    ...toSegments.slice(commonLength),
  ].join("/");
}

function isRelativeInside(relative: string): boolean {
  return relative !== "" && relative !== ".." && !relative.startsWith("../");
}

function basename(filePath: string): string {
  return splitPath(filePath).at(-1) || "";
}

function dirname(filePath: string): string {
  const normalized = normalizePath(filePath);
  const segments = splitPath(normalized);
  segments.pop();

  if (normalized.startsWith("/") && segments.length === 0) return "/";
  if (/^[A-Za-z]:[\\/]/.test(normalized) && segments.length === 1) return `${segments[0]}/`;

  return `${normalized.startsWith("/") ? "/" : ""}${segments.join("/")}` || ".";
}

function hasHiddenDirectory(relativeFilePath: string): boolean {
  const segments = relativeFilePath.split("/");
  return segments.slice(0, -1).some((segment) => segment.startsWith("."));
}

async function rootExists(root: string): Promise<boolean> {
  try {
    const glob = new Bun.Glob("*");
    for await (const _entry of glob.scan({ cwd: root, dot: true })) {
      break;
    }
    return true;
  } catch {
    return false;
  }
}

export const DEFAULT_OUTPUT_PATH = joinPath(homeDir(), ".skills-manager", "skills.json");

export function defaultRoots(baseHomeDir = homeDir()): string[] {
  return [
    joinPath(baseHomeDir, ".codex", "skills"),
    joinPath(baseHomeDir, ".agents", "skills"),
    joinPath(baseHomeDir, ".codex", "plugins", "cache"),
  ];
}

export function isPublicSkillFile(filePath: string, baseHomeDir = homeDir()): boolean {
  const normalized = normalizePath(filePath);
  const relativeToCodexSkills = relativePath(
    joinPath(baseHomeDir, ".codex", "skills"),
    normalized,
  );

  if (isRelativeInside(relativeToCodexSkills)) {
    const [firstSegment] = relativeToCodexSkills.split("/");
    return firstSegment !== ".system";
  }

  return true;
}

function parseScalar(value: string): MetadataValue {
  const trimmed = value.trim();

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  if (trimmed === "true") return true;
  if (trimmed === "false") return false;

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((item) => parseScalar(item))
      .filter((item) => item !== "");
  }

  return trimmed;
}

export function parseFrontmatter(markdown: string): {
  data: Record<string, MetadataValue>;
  body: string;
} {
  if (!markdown.startsWith("---\n")) {
    return { data: {}, body: markdown };
  }

  const endIndex = markdown.indexOf("\n---", 4);
  if (endIndex === -1) {
    return { data: {}, body: markdown };
  }

  const rawFrontmatter = markdown.slice(4, endIndex);
  const body = markdown.slice(endIndex).replace(/^\n---\r?\n?/, "");
  const data: Record<string, MetadataValue> = {};

  for (const line of rawFrontmatter.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf(":");
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1);
    data[key] = parseScalar(value);
  }

  return { data, body };
}

function firstHeading(markdown: string): string {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : "";
}

function firstParagraph(markdown: string): string {
  const withoutHeadings = markdown
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");

  const match = withoutHeadings.match(/(?:^|\n)([^\n`>-][^\n]+(?:\n[^\n`>-][^\n]+)*)/);
  return match ? match[1].replace(/\s+/g, " ").trim() : "";
}

export function sourceForSkill(
  skillFile: string,
  roots: string[],
  baseHomeDir = homeDir(),
): SkillSourceInfo {
  const normalized = normalizePath(skillFile);
  const matchingRoot = roots.map(normalizePath).find((root) => {
    const relative = relativePath(root, normalized);
    return isRelativeInside(relative);
  });

  if (!matchingRoot) {
    return {
      kind: "unknown",
      root: null,
      relativePath: basename(skillFile),
    };
  }

  const skillRelativePath = relativePath(matchingRoot, normalized);
  const codexSkillsRoot = joinPath(baseHomeDir, ".codex", "skills");
  const agentsSkillsRoot = joinPath(baseHomeDir, ".agents", "skills");
  const pluginCacheRoot = joinPath(baseHomeDir, ".codex", "plugins", "cache");

  if (matchingRoot === normalizePath(codexSkillsRoot)) {
    return { kind: "codex", root: matchingRoot, relativePath: skillRelativePath };
  }

  if (matchingRoot === normalizePath(agentsSkillsRoot)) {
    return { kind: "agents", root: matchingRoot, relativePath: skillRelativePath };
  }

  if (matchingRoot === normalizePath(pluginCacheRoot)) {
    return { kind: "plugin", root: matchingRoot, relativePath: skillRelativePath };
  }

  return { kind: "custom", root: matchingRoot, relativePath: skillRelativePath };
}

export function buildRef(skillFile: string, roots: string[], baseHomeDir = homeDir()): string {
  const source = sourceForSkill(skillFile, roots, baseHomeDir);
  const segments = source.relativePath.split("/");
  const skillName = segments.at(-2) || basename(dirname(skillFile));

  if (source.kind === "plugin") {
    const skillsIndex = segments.lastIndexOf("skills");
    const pluginId =
      skillsIndex > 0 ? segments.slice(0, skillsIndex).join("/") : segments.slice(0, -2).join("/");
    return `plugin:${pluginId}:${skillName}`;
  }

  return `${source.kind}:${skillName}`;
}

export function skillFromMarkdown(
  skillFile: string,
  markdown: string,
  roots: string[],
  baseHomeDir = homeDir(),
): Skill {
  const { data, body } = parseFrontmatter(markdown);
  const source = sourceForSkill(skillFile, roots, baseHomeDir);
  const skillDirectory = dirname(skillFile);
  const fallbackName = basename(skillDirectory);
  const name = typeof data.name === "string" && data.name ? data.name : fallbackName;
  const title = firstHeading(body) || name;
  const description =
    typeof data.description === "string" && data.description
      ? data.description
      : firstParagraph(body);

  return {
    ref: buildRef(skillFile, roots, baseHomeDir),
    name,
    title,
    description,
    version: data.version || null,
    allowedTools: data["allowed-tools"] || null,
    source: source.kind,
    sourceRoot: source.root,
    relativePath: source.relativePath,
    path: normalizePath(skillFile),
    directory: normalizePath(skillDirectory),
    metadata: data,
  };
}

export async function findSkillFiles(root: string, baseHomeDir = homeDir()): Promise<string[]> {
  const files: string[] = [];
  const glob = new Bun.Glob(`**/${SKILL_FILE}`);

  try {
    for await (const skillFile of glob.scan({ cwd: root, absolute: true, dot: true })) {
      const relativeSkillPath = relativePath(root, skillFile);

      if (hasHiddenDirectory(relativeSkillPath) || !isPublicSkillFile(skillFile, baseHomeDir)) {
        continue;
      }

      files.push(skillFile);
    }
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  return files;
}

export async function collectSkills({
  roots = defaultRoots(),
  homeDir: baseHomeDir = homeDir(),
}: CollectOptions = {}): Promise<Skill[]> {
  const uniqueFiles = new Set<string>();

  for (const root of roots) {
    for (const skillFile of await findSkillFiles(root, baseHomeDir)) {
      uniqueFiles.add(normalizePath(skillFile));
    }
  }

  const skills: Skill[] = [];

  for (const skillFile of [...uniqueFiles].sort()) {
    const markdown = await Bun.file(skillFile).text();
    skills.push(skillFromMarkdown(skillFile, markdown, roots, baseHomeDir));
  }

  return skills.sort((left, right) => left.ref.localeCompare(right.ref));
}

export async function writeSkillsFile({
  outputPath = DEFAULT_OUTPUT_PATH,
  roots = defaultRoots(),
  homeDir: baseHomeDir = homeDir(),
}: WriteOptions = {}): Promise<SkillsPayload> {
  const skills = await collectSkills({ roots, homeDir: baseHomeDir });
  const payload: SkillsPayload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    roots: roots.map(normalizePath),
    count: skills.length,
    skills,
  };

  await Bun.write(outputPath, `${JSON.stringify(payload, null, 2)}\n`);

  return payload;
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

Options:
  -w, --watch        Watch skill roots and rewrite the JSON on SKILL.md changes.
  -o, --output       Output JSON path. Defaults to ~/.skills-manager/skills.json.
  -r, --root         Add a skill root to scan. Can be passed more than once.
  -h, --help         Print this help text.

Environment:
  SKILLS_MANAGER_OUTPUT  Override the output path.
  SKILLS_MANAGER_ROOTS   Replace default roots, separated by the OS path delimiter.
`;
}

async function skillsSnapshot(roots: string[], baseHomeDir: string): Promise<string> {
  const entries: string[] = [];

  for (const root of roots) {
    for (const skillFile of await findSkillFiles(root, baseHomeDir)) {
      try {
        const stats = await Bun.file(skillFile).stat();
        entries.push(`${normalizePath(skillFile)}:${stats.size}:${stats.mtimeMs}`);
      } catch {
        entries.push(`${normalizePath(skillFile)}:missing`);
      }
    }
  }

  return entries.sort().join("\n");
}

export async function watchSkills({
  outputPath = DEFAULT_OUTPUT_PATH,
  roots = defaultRoots(),
  homeDir: baseHomeDir = homeDir(),
  intervalMs = 1000,
}: WatchOptions = {}): Promise<() => void> {
  const existingRoots: string[] = [];

  for (const root of roots) {
    if (await rootExists(root)) {
      existingRoots.push(root);
    }
  }

  if (existingRoots.length === 0) {
    throw new Error(`No skill roots found: ${roots.join(", ")}`);
  }

  let stopped = false;
  let currentSnapshot = await skillsSnapshot(roots, baseHomeDir);

  const sync = async () => {
    const payload = await writeSkillsFile({ outputPath, roots, homeDir: baseHomeDir });
    console.log(`Recorded ${payload.count} skills in ${outputPath}`);
  };

  await sync();

  const watchLoop = async () => {
    while (!stopped) {
      await Bun.sleep(intervalMs);
      if (stopped) break;

      try {
        const nextSnapshot = await skillsSnapshot(roots, baseHomeDir);
        if (nextSnapshot === currentSnapshot) continue;

        currentSnapshot = nextSnapshot;
        await sync();
      } catch (error) {
        console.error(error);
      }
    }
  };

  void watchLoop();
  console.log(`Watching ${existingRoots.length} skill roots. Press Ctrl+C to stop.`);

  return () => {
    stopped = true;
  };
}

async function main(): Promise<void> {
  const args = parseArgs(Bun.argv.slice(2));

  if (args.help) {
    console.log(usage());
    return;
  }

  if (args.watch) {
    await watchSkills(args);
    return;
  }

  const payload = await writeSkillsFile(args);
  console.log(`Recorded ${payload.count} skills in ${args.outputPath}`);
}

if (import.meta.main) await main();
