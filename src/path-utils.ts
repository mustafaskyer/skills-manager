export const SKILL_FILE = "SKILL.md";

export type MetadataValue = string | boolean | readonly MetadataValue[];

export function homeDir(): string {
  return Bun.env.HOME || Bun.env.USERPROFILE || "";
}

export function isAbsolutePath(filePath: string): boolean {
  return filePath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(filePath);
}

export function splitPath(filePath: string): string[] {
  return filePath.split(/[\\/]+/).filter(Boolean);
}

export function normalizePath(filePath: string): string {
  const expanded = filePath.startsWith("~")
    ? `${homeDir()}${filePath.slice(1)}`
    : filePath;
  const raw = isAbsolutePath(expanded) ? expanded : `${Bun.env.PWD || import.meta.dir}/${expanded}`;
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

export function joinPath(...parts: string[]): string {
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

export function relativePath(from: string, to: string): string {
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

export function isRelativeInside(relative: string): boolean {
  return relative !== "" && relative !== ".." && !relative.startsWith("../");
}

export function basename(filePath: string): string {
  return splitPath(filePath).at(-1) || "";
}

export function dirname(filePath: string): string {
  const normalized = normalizePath(filePath);
  const segments = splitPath(normalized);
  segments.pop();

  if (normalized.startsWith("/") && segments.length === 0) return "/";
  if (/^[A-Za-z]:[\\/]/.test(normalized) && segments.length === 1) return `${segments[0]}/`;

  return `${normalized.startsWith("/") ? "/" : ""}${segments.join("/")}` || ".";
}

export function hasHiddenDirectory(relativeFilePath: string): boolean {
  const segments = relativeFilePath.split("/");
  return segments.slice(0, -1).some((segment) => segment.startsWith("."));
}

export async function rootExists(root: string): Promise<boolean> {
  try {
    const glob = new Bun.Glob("*");
    for await (const _entry of glob.scan({ cwd: root, dot: true })) {
      return true;
    }
    return true;
  } catch {
    return false;
  }
}

export async function ensureParentDirectory(filePath: string): Promise<void> {
  await Bun.$`mkdir -p ${dirname(filePath)}`.quiet();
}
