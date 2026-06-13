import { Context, Effect, Layer } from "effect";

import { collectProviderSkills, findSkillByRef, type CatalogOptions } from "../catalog/SkillCatalog";
import { ServerStartError, type SkillWarning } from "../domain";
import { parseFrontmatter } from "../frontmatter";
import {
  SKILL_FILE,
  basename,
  homeDir as defaultHomeDir,
  isAbsolutePath,
  isRelativeInside,
  joinPath,
  relativePath,
  splitPath,
} from "../path-utils";
import { getDefaultProvider } from "../providers/registry";

export type DashboardServerOptions = CatalogOptions & {
  host?: string;
  port?: number;
};

export type RunningDashboardServer = {
  url: string;
  host: string;
  port: number;
  stop: () => Promise<void>;
};

const MAX_PREVIEW_BYTES = 256 * 1024;
const MAX_TREE_ENTRIES = 500;
const packageJson = await Bun.file(joinPath(import.meta.dir, "..", "..", "package.json")).json();
let stylesheetBuild: Promise<string> | null = null;

type SkillFileTreeEntry = {
  path: string;
  name: string;
  type: "directory" | "file";
  size: number | null;
};

function normalizeSkillRelativePath(input: string | null): string | null {
  const value = input?.trim() || SKILL_FILE;
  if (isAbsolutePath(value)) return null;

  const segments: string[] = [];
  for (const segment of value.split(/[\\/]+/)) {
    if (!segment || segment === ".") continue;
    if (segment === "..") return null;
    segments.push(segment);
  }

  return segments.join("/") || SKILL_FILE;
}

function isMarkdownFile(filePath: string): boolean {
  return /\.mdx?$/i.test(filePath);
}

function looksBinary(content: string): boolean {
  return content.includes("\u0000");
}

async function readSkillDirectoryTree(directory: string): Promise<SkillFileTreeEntry[]> {
  const files = new Map<string, SkillFileTreeEntry>();
  const directories = new Set<string>();
  const glob = new Bun.Glob("**/*");
  let count = 0;

  for await (const entry of glob.scan({ cwd: directory, dot: true, absolute: false })) {
    if (count >= MAX_TREE_ENTRIES) break;
    const relativeEntry = normalizeSkillRelativePath(entry);
    if (!relativeEntry) continue;

    const filePath = joinPath(directory, relativeEntry);
    const stat = await Bun.file(filePath).stat().catch(() => null);
    if (!stat) continue;

    count += 1;
    const parentSegments = splitPath(relativeEntry);
    parentSegments.pop();
    for (let index = 1; index <= parentSegments.length; index += 1) {
      directories.add(parentSegments.slice(0, index).join("/"));
    }

    if (stat.isDirectory()) {
      directories.add(relativeEntry);
    } else {
      files.set(relativeEntry, {
        path: relativeEntry,
        name: basename(relativeEntry),
        type: "file",
        size: stat.size,
      });
    }
  }

  return [
    ...[...directories].map((path) => ({
      path,
      name: basename(path),
      type: "directory" as const,
      size: null,
    })),
    ...files.values(),
  ].sort((left, right) => {
    if (left.type !== right.type) return left.type === "directory" ? -1 : 1;
    return left.path.localeCompare(right.path);
  });
}

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(init?.headers ?? {}),
    },
  });
}

function notFound(message: string, ref = ""): Response {
  return jsonResponse(
    {
      apiVersion: 1,
      warnings: [{ code: "PreviewReadError", ref, message }],
    },
    { status: 404 },
  );
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.text();
    if (!body.trim()) return {};
    const parsed = JSON.parse(body);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

async function buildStylesheet(): Promise<string> {
  const input = joinPath(import.meta.dir, "..", "ui", "styles.css");
  const bunExecutable = Bun.argv[0] ?? "bun";
  const process = Bun.spawn({
    cmd: [bunExecutable, "x", "tailwindcss", "-i", input, "--minify"],
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(stderr || `tailwindcss exited with code ${exitCode}`);
  }

  return stdout;
}

async function readCompiledStylesheet(): Promise<Response> {
  stylesheetBuild ??= buildStylesheet().catch((error) => {
    stylesheetBuild = null;
    throw error;
  });

  try {
    return new Response(await stylesheetBuild, {
      headers: {
        "content-type": "text/css; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : String(error), { status: 500 });
  }
}

async function readUiAsset(pathname: string): Promise<Response> {
  if (pathname === "/assets/app.js") {
    const result = await Bun.build({
      entrypoints: [joinPath(import.meta.dir, "..", "ui", "main.tsx")],
      minify: false,
      target: "browser",
    });
    if (!result.success || !result.outputs[0]) {
      return new Response("Failed to build dashboard bundle", { status: 500 });
    }
    return new Response(result.outputs[0], {
      headers: { "content-type": "application/javascript; charset=utf-8" },
    });
  }

  if (pathname === "/styles.css") {
    return readCompiledStylesheet();
  }

  const assetPath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = joinPath(import.meta.dir, "..", "ui", assetPath);
  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    if (!assetPath.includes(".")) {
      return new Response(Bun.file(joinPath(import.meta.dir, "..", "ui", "index.html")), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    return new Response("Not found", { status: 404 });
  }

  const contentType = assetPath.endsWith(".css")
    ? "text/css; charset=utf-8"
    : assetPath.endsWith(".tsx") || assetPath.endsWith(".ts")
      ? "application/javascript; charset=utf-8"
      : "text/html; charset=utf-8";
  return new Response(file, { headers: { "content-type": contentType } });
}

async function handleApi(
  request: Request,
  url: URL,
  options: Required<Pick<DashboardServerOptions, "host" | "port">> & CatalogOptions,
) {
  const snapshot = await collectProviderSkills(options);

  if (url.pathname === "/api/health" || url.pathname === "/api/v1/health") {
    return jsonResponse({
      apiVersion: 1,
      status: "ok",
      version: packageJson.version,
      providers: snapshot.providerInfos.filter((provider) => provider.enabled).map((provider) => provider.id),
      skillCount: snapshot.count,
      warningCount: (snapshot.warnings ?? []).length,
    });
  }

  if (url.pathname === "/api/providers" || url.pathname === "/api/v1/providers") {
    return jsonResponse({ apiVersion: 1, providers: snapshot.providerInfos });
  }

  if (url.pathname === "/api/skills" || url.pathname === "/api/v1/skills") {
    const { providerInfos: _providerInfos, ...payload } = snapshot;
    return jsonResponse(payload);
  }

  const skillFilesMatch = url.pathname.match(/^\/api\/v1\/skills\/(.+)\/files$/)
    ?? url.pathname.match(/^\/api\/skills\/(.+)\/files$/);

  if (skillFilesMatch?.[1]) {
    const ref = decodeURIComponent(skillFilesMatch[1]);
    const skill = findSkillByRef(snapshot, ref);
    if (!skill) {
      return notFound("Skill ref is not in the current catalog.", ref);
    }

    const selectedPath = normalizeSkillRelativePath(url.searchParams.get("path"));
    if (!selectedPath) {
      return jsonResponse(
        {
          apiVersion: 1,
          warnings: [{
            code: "PreviewReadError",
            provider: skill.provider,
            ref: skill.ref,
            path: url.searchParams.get("path") ?? "",
            message: "Requested file path must stay inside the skill directory.",
          }],
        },
        { status: 400 },
      );
    }

    const directory = skill.directory;
    const targetPath = joinPath(directory, selectedPath);
    const resolvedRelativePath = relativePath(directory, targetPath);
    if (resolvedRelativePath !== selectedPath || !isRelativeInside(resolvedRelativePath)) {
      return jsonResponse(
        {
          apiVersion: 1,
          warnings: [{
            code: "PreviewReadError",
            provider: skill.provider,
            ref: skill.ref,
            path: selectedPath,
            message: "Requested file path must stay inside the skill directory.",
          }],
        },
        { status: 400 },
      );
    }

    const tree = await readSkillDirectoryTree(directory);
    const stat = await Bun.file(targetPath).stat().catch(() => null);
    if (!stat || stat.isDirectory()) {
      return jsonResponse(
        {
          apiVersion: 1,
          skill,
          tree,
          selectedPath,
          warnings: [{
            code: "PreviewReadError",
            provider: skill.provider,
            ref: skill.ref,
            path: selectedPath,
            message: "Requested file is not available in the selected skill directory.",
          }],
        },
        { status: 404 },
      );
    }

    const warnings: SkillWarning[] = [];
    const truncated = stat.size > MAX_PREVIEW_BYTES;
    const rawContent = truncated
      ? (await Bun.file(targetPath).text()).slice(0, MAX_PREVIEW_BYTES)
      : await Bun.file(targetPath).text();
    const binary = looksBinary(rawContent);
    const content = binary
      ? ""
      : isMarkdownFile(selectedPath)
        ? parseFrontmatter(rawContent).body
        : rawContent;

    if (truncated) {
      warnings.push({
        code: "PreviewTooLarge",
        provider: skill.provider,
        ref: skill.ref,
        path: selectedPath,
        message: `Preview truncated at ${MAX_PREVIEW_BYTES} bytes.`,
      });
    }

    if (binary) {
      warnings.push({
        code: "PreviewReadError",
        provider: skill.provider,
        ref: skill.ref,
        path: selectedPath,
        message: "Binary files cannot be previewed.",
      });
    }

    return jsonResponse({
      apiVersion: 1,
      skill,
      tree,
      selectedPath,
      file: {
        path: selectedPath,
        name: basename(selectedPath),
        kind: binary ? "binary" : isMarkdownFile(selectedPath) ? "markdown" : "text",
        content,
        size: stat.size,
        truncated,
      },
      warnings,
    });
  }

  const uninstallMatch = url.pathname.match(/^\/api\/v1\/skills\/(.+)\/uninstall$/);

  if (uninstallMatch?.[1]) {
    if (request.method !== "POST") {
      return jsonResponse({ apiVersion: 1, warnings: [] }, { status: 405 });
    }

    const ref = decodeURIComponent(uninstallMatch[1]);
    const skill = findSkillByRef(snapshot, ref);
    if (!skill) {
      return notFound("Skill ref is not in the current catalog.", ref);
    }

    const body = await readJsonBody(request);
    if (body.confirmRef !== skill.ref) {
      return jsonResponse(
        {
          apiVersion: 1,
          warnings: [{
            code: "SkillUninstallError",
            provider: skill.provider,
            ref: skill.ref,
            path: skill.directory,
            message: "Confirmation ref must match the provider-aware skill ref.",
          }],
        },
        { status: 400 },
      );
    }

    const provider = getDefaultProvider(skill.provider);
    if (!provider?.uninstall) {
      return jsonResponse(
        {
          apiVersion: 1,
          warnings: [{
            code: "SkillUninstallError",
            provider: skill.provider,
            ref: skill.ref,
            path: skill.directory,
            message: `Provider does not support uninstall: ${skill.provider}`,
          }],
        },
        { status: 400 },
      );
    }

    const result = await Effect.runPromise(provider.uninstall(skill, {
      homeDir: options.homeDir ?? defaultHomeDir(),
      roots: options.rootsByProvider?.[skill.provider],
    }));
    return jsonResponse(result, { status: result.warnings.length > 0 ? 400 : 200 });
  }

  const previewPrefix = url.pathname.startsWith("/api/v1/skills/")
    ? "/api/v1/skills/"
    : url.pathname.startsWith("/api/skills/")
      ? "/api/skills/"
      : null;

  if (previewPrefix) {
    const encodedRef = url.pathname.slice(previewPrefix.length);
    const ref = decodeURIComponent(encodedRef);
    const skill = findSkillByRef(snapshot, ref);
    if (!skill) {
      return notFound("Skill ref is not in the current catalog.", ref);
    }

    const stat = await Bun.file(skill.path).stat();
    const warnings: SkillWarning[] = [];
    const truncated = stat.size > MAX_PREVIEW_BYTES;
    const rawMarkdown = truncated
      ? (await Bun.file(skill.path).text()).slice(0, MAX_PREVIEW_BYTES)
      : await Bun.file(skill.path).text();
    const markdown = parseFrontmatter(rawMarkdown).body;

    if (truncated) {
      warnings.push({
        code: "PreviewTooLarge",
        provider: skill.provider,
        ref: skill.ref,
        path: skill.path,
        message: `Preview truncated at ${MAX_PREVIEW_BYTES} bytes.`,
      });
    }

    return jsonResponse({ apiVersion: 1, skill, markdown, truncated, warnings });
  }

  return null;
}

export async function startDashboardServer(options: DashboardServerOptions = {}): Promise<RunningDashboardServer> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 3737;
  const normalizedOptions = { ...options, host, port };

  try {
    const server = Bun.serve({
      hostname: host,
      port,
      async fetch(request) {
        const url = new URL(request.url);

        if (url.pathname.startsWith("/api/")) {
          const response = await handleApi(request, url, normalizedOptions);
          return response ?? jsonResponse({ apiVersion: 1, warnings: [] }, { status: 404 });
        }

        return readUiAsset(url.pathname);
      },
    });

    return {
      url: `http://${host}:${server.port}`,
      host,
      port: server.port ?? port,
      stop: async () => {
        await server.stop();
      },
    };
  } catch (error) {
    throw new ServerStartError({
      host,
      port,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export function dashboardServerResource(options: DashboardServerOptions = {}) {
  return Effect.acquireRelease(
    Effect.promise(() => startDashboardServer(options)),
    (server) => Effect.promise(() => server.stop()),
  );
}

export class DashboardServer extends Context.Service<DashboardServer, {
  readonly start: (options?: DashboardServerOptions) => Effect.Effect<RunningDashboardServer, ServerStartError>;
}>()("skills-manager/server/DashboardServer") {
  static readonly layer = Layer.succeed(
    DashboardServer,
    DashboardServer.of({
      start: (options) =>
        Effect.tryPromise({
          try: () => startDashboardServer(options),
          catch: (error) =>
            error instanceof ServerStartError
              ? error
              : new ServerStartError({
                  host: options?.host ?? "127.0.0.1",
                  port: options?.port ?? 3737,
                  message: error instanceof Error ? error.message : String(error),
                }),
        }),
    }),
  );
}
