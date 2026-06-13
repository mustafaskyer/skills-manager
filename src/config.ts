import { joinPath, normalizePath, homeDir as defaultHomeDir } from "./path-utils";

const RUNTIME_IS_WINDOWS =
  (Bun.env.OS ?? "").startsWith("Windows") || /^[A-Za-z]:[\\/]/.test(import.meta.dir);
const PATH_DELIMITER = RUNTIME_IS_WINDOWS ? ";" : ":";

export type RawConfig = {
  providers?: string[];
  roots?: string[];
  outputPath?: string;
  host?: string;
  port?: number;
};

export type ResolveConfigOptions = {
  homeDir?: string;
  providers?: readonly string[];
  roots?: readonly string[];
  outputPath?: string;
  host?: string;
  port?: number;
};

export type ResolvedConfig = {
  homeDir: string;
  providers: string[];
  rootsByProvider: Record<string, string[]>;
  outputPath: string;
  host: string;
  port: number;
};

export const DEFAULT_OUTPUT_PATH = joinPath(defaultHomeDir(), ".skills-manager", "skills.json");

async function readConfigFile(): Promise<RawConfig> {
  const file = Bun.file(joinPath(Bun.env.PWD || process.cwd(), "skillsmanager.config.json"));
  if (!(await file.exists())) return {};
  return await file.json();
}

function envList(name: string): string[] | undefined {
  const value = Bun.env[name];
  return value ? value.split(PATH_DELIMITER).filter(Boolean) : undefined;
}

export async function resolveConfig(options: ResolveConfigOptions = {}): Promise<ResolvedConfig> {
  const configFile = await readConfigFile();
  const resolvedHomeDir = options.homeDir ?? defaultHomeDir();
  const providers = [
    ...(options.providers && options.providers.length > 0
      ? options.providers
      : configFile.providers && configFile.providers.length > 0
        ? configFile.providers
        : envList("SKILLS_MANAGER_PROVIDERS") ?? ["codex"]),
  ];
  const roots = [
    ...(options.roots && options.roots.length > 0
      ? options.roots
      : configFile.roots && configFile.roots.length > 0
        ? configFile.roots
        : envList("SKILLS_MANAGER_ROOTS") ?? []),
  ].map(normalizePath);

  const rootsByProvider = roots.length > 0
    ? Object.fromEntries(providers.map((provider) => [provider, roots]))
    : {};

  return {
    homeDir: resolvedHomeDir,
    providers,
    rootsByProvider,
    outputPath: normalizePath(
      options.outputPath ?? configFile.outputPath ?? Bun.env.SKILLS_MANAGER_OUTPUT ?? DEFAULT_OUTPUT_PATH,
    ),
    host: options.host ?? configFile.host ?? "127.0.0.1",
    port: options.port ?? configFile.port ?? 3737,
  };
}
