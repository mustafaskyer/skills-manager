import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  FileText,
  FolderClosed,
  Layers,
  Loader2,
  Package,
  RefreshCw,
  Search,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import { Streamdown } from "streamdown";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { createMermaidPlugin } from "@streamdown/mermaid";

import { Alert } from "./components/ui/alert";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./components/ui/select";

type SkillWarning = {
  code: string;
  provider?: string;
  ref?: string;
  path?: string;
  message: string;
};

type Skill = {
  ref: string;
  legacyRef: string;
  provider: string;
  providerLabel: string;
  sourceType: string;
  name: string;
  title: string;
  description: string;
  path: string;
  directory: string;
  relativePath: string;
  pluginId: string | null;
};

type SkillsPayload = {
  apiVersion: 1;
  schemaVersion: 2;
  count: number;
  skills: Skill[];
  warnings: SkillWarning[];
};

type SkillFileTreeEntry = {
  path: string;
  name: string;
  type: "directory" | "file";
  size: number | null;
};

type SkillFilePayload = {
  apiVersion: 1;
  skill: Skill;
  tree: SkillFileTreeEntry[];
  selectedPath: string;
  file?: {
    path: string;
    name: string;
    kind: "markdown" | "text" | "binary";
    content: string;
    size: number;
    truncated: boolean;
  };
  warnings: SkillWarning[];
};

type SkillUninstallStep = {
  name: SkillUninstallStepName;
  status: "pending" | "running" | "completed" | "failed";
  message: string;
};

type SkillUninstallPayload = {
  apiVersion: 1;
  skill: Skill;
  steps: SkillUninstallStep[];
  removedPaths: string[];
  lockUpdated: boolean;
  warnings: SkillWarning[];
};

type Route =
  | { name: "catalog" }
  | { name: "skill"; ref: string }
  | { name: "uninstall"; ref: string };

const PAGE_SIZE = 16;
const UNINSTALL_STEP_DELAY_MS = 650;
const UNINSTALL_STEP_NAMES = ["locating repo", "removing", "checking", "removed"] as const;

type SkillUninstallStepName = typeof UNINSTALL_STEP_NAMES[number];

function routeFromLocation(): Route {
  const prefix = "/skills/";
  if (window.location.pathname.startsWith(prefix)) {
    const encodedRef = window.location.pathname.slice(prefix.length);
    if (encodedRef.endsWith("/uninstall")) {
      return { name: "uninstall", ref: decodeURIComponent(encodedRef.slice(0, -"/uninstall".length)) };
    }
    if (encodedRef) return { name: "skill", ref: decodeURIComponent(encodedRef) };
  }

  return { name: "catalog" };
}

function skillRoute(ref: string): string {
  return `/skills/${encodeURIComponent(ref)}`;
}

function uninstallRoute(ref: string): string {
  return `${skillRoute(ref)}/uninstall`;
}

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort();
}

function includesQuery(skill: Skill, query: string): boolean {
  const haystack = [
    skill.name,
    skill.title,
    skill.description,
    skill.ref,
    skill.legacyRef,
    skill.path,
    skill.pluginId ?? "",
  ].join(" ").toLowerCase();
  return haystack.includes(query.toLowerCase());
}

function safeMarkdownUrlTransform(url: string, key: string): string | null {
  if (key === "src") return null;
  if (key !== "href") return url;

  try {
    const parsed = new URL(url, window.location.origin);
    if (parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "mailto:") {
      return url;
    }
  } catch {
    return null;
  }

  return null;
}

function fileSizeLabel(size: number | null): string {
  if (size === null) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 102.4) / 10} KB`;
  return `${Math.round(size / 1024 / 102.4) / 10} MB`;
}

function treeDepth(path: string): number {
  return Math.max(0, path.split("/").length - 1);
}

function parentDirectories(path: string): string[] {
  const segments = path.split("/");
  return segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join("/"));
}

const mermaid = createMermaidPlugin({
  config: {
    securityLevel: "strict",
    theme: "neutral",
  },
});

function MarkdownPreview({ content }: { content: string }) {
  return (
    <div className="markdown markdown-rendered">
      <Streamdown
        mode="static"
        skipHtml
        controls={{
          code: { copy: true, download: false },
          mermaid: { copy: true, download: false, fullscreen: false, panZoom: true },
          table: { copy: true, download: false, fullscreen: false },
        }}
        linkSafety={{ enabled: true }}
        plugins={{ cjk, code, math, mermaid }}
        shikiTheme={["github-light", "github-dark"]}
        urlTransform={safeMarkdownUrlTransform}
      >
        {content}
      </Streamdown>
    </div>
  );
}

function SkillRow({ skill, onOpen }: { skill: Skill; onOpen: (skill: Skill) => void }) {
  const hasDescription = skill.description.trim().length > 0;

  return (
    <button type="button" className="skill-row" onClick={() => onOpen(skill)}>
      <span className="skill-row-main">
        <span className="skill-row-title">{skill.title}</span>
        <span className={`skill-row-description ${hasDescription ? "" : "empty"}`}>
          {hasDescription ? skill.description : "No description provided."}
        </span>
      </span>
      <span className="skill-row-side">
        <span className="skill-row-actions">
          <span className="skill-row-meta">
            <Badge>{skill.sourceType}</Badge>
            <Badge variant="outline">{skill.providerLabel}</Badge>
            {skill.pluginId ? <Badge variant="outline">{skill.pluginId}</Badge> : null}
          </span>
          <ArrowRight className="skill-row-arrow" size={16} aria-hidden="true" />
        </span>
        <span className="skill-row-path">{skill.relativePath}</span>
      </span>
    </button>
  );
}

function FilterButton({
  active,
  count,
  disabled = false,
  label,
  onClick,
}: {
  active: boolean;
  count: number;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`sidebar-filter ${active ? "active" : ""}`}
      disabled={disabled}
      title={disabled ? "Filters are available in catalog view" : undefined}
      onClick={onClick}
    >
      <span>{label}</span>
      <small>{count}</small>
    </button>
  );
}

function Tree({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="file-tree" role="tree" aria-label={label}>
      {children}
    </div>
  );
}

function TreeItemLabel({
  entry,
  expanded,
}: {
  entry: SkillFileTreeEntry;
  expanded?: boolean;
}) {
  const isDirectory = entry.type === "directory";
  const Icon = isDirectory ? FolderClosed : FileText;

  return (
    <>
      <span className="tree-expander" aria-hidden="true">
        {isDirectory ? expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} /> : null}
      </span>
      <Icon size={15} aria-hidden="true" />
      <span className="tree-item-name">{entry.name}</span>
      {entry.type === "file" ? <small>{fileSizeLabel(entry.size)}</small> : null}
    </>
  );
}

function TreeItem({
  entry,
  selected,
  expanded,
  onPress,
}: {
  entry: SkillFileTreeEntry;
  selected: boolean;
  expanded?: boolean;
  onPress: () => void;
}) {
  const isDirectory = entry.type === "directory";

  return (
    <button
      key={`${entry.type}:${entry.path}`}
      type="button"
      role="treeitem"
      aria-level={treeDepth(entry.path) + 1}
      aria-expanded={isDirectory ? expanded : undefined}
      aria-selected={selected}
      className={`file-tree-row ${selected ? "active" : ""}`}
      style={{ "--depth": treeDepth(entry.path) } as React.CSSProperties}
      onClick={onPress}
    >
      <TreeItemLabel entry={entry} expanded={expanded} />
    </button>
  );
}

function FileTree({
  entries,
  selectedPath,
  onSelect,
}: {
  entries: SkillFileTreeEntry[];
  selectedPath: string;
  onSelect: (path: string) => void;
}) {
  const directories = useMemo(
    () => entries.filter((entry) => entry.type === "directory").map((entry) => entry.path),
    [entries],
  );
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(() => new Set(directories));

  useEffect(() => {
    setExpandedDirectories(new Set(directories));
  }, [directories]);

  const visibleEntries = entries.filter((entry) =>
    parentDirectories(entry.path).every((parentPath) => expandedDirectories.has(parentPath))
  );

  const toggleDirectory = (path: string) => {
    setExpandedDirectories((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  return (
    <Tree label="Skill files">
      {visibleEntries.map((entry) => {
        const isDirectory = entry.type === "directory";
        const isExpanded = expandedDirectories.has(entry.path);
        return (
          <TreeItem
            key={`${entry.type}:${entry.path}`}
            entry={entry}
            selected={entry.path === selectedPath}
            expanded={isDirectory ? isExpanded : undefined}
            onPress={() => isDirectory ? toggleDirectory(entry.path) : onSelect(entry.path)}
          />
        );
      })}
    </Tree>
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function uninstallStepsAt(activeIndex: number, failedIndex: number | null = null): SkillUninstallStep[] {
  return UNINSTALL_STEP_NAMES.map((name, index) => ({
    name,
    status: failedIndex === index
      ? "failed"
      : index < activeIndex
        ? "completed"
        : index === activeIndex
          ? "running"
          : "pending",
    message: name,
  }));
}

function initialUninstallSteps(): SkillUninstallStep[] {
  return uninstallStepsAt(0);
}

async function playUninstallProgress(setSteps: React.Dispatch<React.SetStateAction<SkillUninstallStep[]>>) {
  for (let index = 0; index < UNINSTALL_STEP_NAMES.length; index += 1) {
    setSteps(uninstallStepsAt(index));
    await delay(UNINSTALL_STEP_DELAY_MS);
  }

  setSteps(uninstallStepsAt(UNINSTALL_STEP_NAMES.length));
}

function UninstallDialog({
  mode,
  skill,
  onCancel,
  onConfirm,
}: {
  mode: "confirm" | "blocked";
  skill: Skill;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const blocked = mode === "blocked";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-zinc-950/40 px-4" role="presentation">
      <section
        aria-modal="true"
        role="dialog"
        aria-labelledby="uninstall-dialog-title"
        className="w-full max-w-[560px] rounded-lg border border-zinc-200 bg-white shadow-xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-zinc-200 px-5 py-4">
          <div className="min-w-0">
            <p className="mb-1 text-xs font-semibold uppercase tracking-normal text-zinc-500">
              {blocked ? "Managed source" : "Uninstall skill"}
            </p>
            <h3 id="uninstall-dialog-title" className="m-0 text-base font-semibold leading-6 text-zinc-950">
              {skill.title}
            </h3>
          </div>
          <button
            type="button"
            className="grid h-8 w-8 place-items-center rounded-md border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
            onClick={onCancel}
            aria-label="Close"
          >
            <X size={15} />
          </button>
        </header>
        <div className="grid gap-4 px-5 py-4">
          {blocked ? (
            <Alert variant="warning">
              Plugin-cache skills are managed by plugin installation and cannot be uninstalled safely here.
            </Alert>
          ) : (
            <Alert variant="destructive">
              This removes the selected skill installation path from disk.
            </Alert>
          )}
          <dl className="grid gap-2 text-sm">
            <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-3">
              <dt className="text-zinc-500">Provider</dt>
              <dd className="m-0 min-w-0 text-zinc-950">{skill.providerLabel}</dd>
            </div>
            <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-3">
              <dt className="text-zinc-500">Source</dt>
              <dd className="m-0 min-w-0 text-zinc-950">{skill.sourceType}</dd>
            </div>
            <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-3">
              <dt className="text-zinc-500">Path</dt>
              <dd className="m-0 min-w-0 break-all font-mono text-xs text-zinc-800">{skill.directory}</dd>
            </div>
          </dl>
        </div>
        <footer className="flex justify-end gap-2 border-t border-zinc-200 px-5 py-4">
          <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
          {!blocked ? (
            <Button
              type="button"
              className="border-red-600 bg-red-600 text-white hover:border-red-700 hover:bg-red-700"
              onClick={onConfirm}
            >
              <Trash2 size={14} /> Uninstall
            </Button>
          ) : null}
        </footer>
      </section>
    </div>
  );
}

function UninstallProgress({
  result,
  skill,
  steps,
  working,
  error,
  onBack,
}: {
  result: SkillUninstallPayload | null;
  skill: Skill | null;
  steps: SkillUninstallStep[];
  working: boolean;
  error: string | null;
  onBack: () => void;
}) {
  return (
    <section className="grid gap-4 px-6 py-3">
      <Button type="button" variant="outline" size="sm" className="w-fit" onClick={onBack}>
        <ArrowLeft size={15} /> Catalog
      </Button>
      <div className="rounded-lg border border-zinc-200 bg-white p-5">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="m-0 text-xs font-semibold uppercase tracking-normal text-zinc-500">Uninstall</p>
            <h3 className="m-0 mt-1 text-lg font-semibold leading-6 text-zinc-950">
              {skill?.title ?? result?.skill.title ?? "Skill"}
            </h3>
          </div>
          {working ? <Badge variant="outline"><Loader2 className="animate-spin" size={13} /> working</Badge> : null}
          {result && !error ? <Badge variant="outline">removed</Badge> : null}
        </div>
        <ol className="grid gap-3">
          {steps.map((step) => (
            <li key={step.name} className="grid grid-cols-[28px_minmax(0,1fr)] items-center gap-3">
              <span className={`grid h-7 w-7 place-items-center rounded-full border text-xs ${
                step.status === "completed"
                  ? "border-emerald-600 bg-emerald-50 text-emerald-700"
                  : step.status === "failed"
                    ? "border-red-600 bg-red-50 text-red-700"
                    : step.status === "running"
                      ? "border-blue-600 bg-blue-50 text-blue-700"
                      : "border-zinc-200 bg-zinc-50 text-zinc-400"
              }`}>
                {step.status === "running" ? <Loader2 className="animate-spin" size={13} /> : null}
                {step.status === "completed" ? <Check size={13} /> : null}
                {step.status === "failed" ? <ShieldAlert size={13} /> : null}
              </span>
              <span className="text-sm font-medium text-zinc-950">{step.message}</span>
            </li>
          ))}
        </ol>
        {error ? <Alert className="mt-5" variant="destructive">{error}</Alert> : null}
        {result?.removedPaths.length ? (
          <div className="mt-5 rounded-md border border-zinc-200 bg-zinc-50 p-3">
            <p className="m-0 mb-2 text-xs font-semibold uppercase tracking-normal text-zinc-500">Removed paths</p>
            {result.removedPaths.map((path) => (
              <p key={path} className="m-0 break-all font-mono text-xs text-zinc-800">{path}</p>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function App() {
  const [route, setRoute] = useState<Route>(() => routeFromLocation());
  const [payload, setPayload] = useState<SkillsPayload | null>(null);
  const [filePayload, setFilePayload] = useState<SkillFilePayload | null>(null);
  const [selectedFilePath, setSelectedFilePath] = useState("SKILL.md");
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState("all");
  const [pluginId, setPluginId] = useState("all");
  const [sourceType, setSourceType] = useState("all");
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [fileLoading, setFileLoading] = useState(false);
  const [copiedSelection, setCopiedSelection] = useState(false);
  const [uninstallDialog, setUninstallDialog] = useState<"confirm" | "blocked" | null>(null);
  const [uninstallSteps, setUninstallSteps] = useState<SkillUninstallStep[]>(initialUninstallSteps);
  const [uninstallResult, setUninstallResult] = useState<SkillUninstallPayload | null>(null);
  const [uninstallError, setUninstallError] = useState<string | null>(null);
  const [uninstallWorking, setUninstallWorking] = useState(false);

  const loadSkills = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/skills");
      if (!response.ok) throw new Error(`API returned ${response.status}`);
      const nextPayload = await response.json() as SkillsPayload;
      setPayload(nextPayload);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setLoading(false);
    }
  };

  const loadSkillFile = async (ref: string, path: string) => {
    setFileLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/skills/${encodeURIComponent(ref)}/files?path=${encodeURIComponent(path)}`,
      );
      if (!response.ok) throw new Error(`File preview returned ${response.status}`);
      const nextPayload = await response.json() as SkillFilePayload;
      setFilePayload(nextPayload);
      setSelectedFilePath(nextPayload.selectedPath);
    } catch (nextError) {
      setFilePayload(null);
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setFileLoading(false);
    }
  };

  const navigate = (nextRoute: Route) => {
    const nextPath = nextRoute.name === "catalog"
      ? "/"
      : nextRoute.name === "uninstall"
        ? uninstallRoute(nextRoute.ref)
        : skillRoute(nextRoute.ref);
    window.history.pushState(null, "", nextPath);
    setRoute(nextRoute);
  };

  useEffect(() => {
    void loadSkills();
  }, []);

  useEffect(() => {
    const onPopState = () => setRoute(routeFromLocation());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    setPage(1);
  }, [query, provider, pluginId, sourceType]);

  useEffect(() => {
    if (route.name !== "skill") {
      setFilePayload(null);
      setSelectedFilePath("SKILL.md");
      return;
    }

    setSelectedFilePath("SKILL.md");
    void loadSkillFile(route.ref, "SKILL.md");
  }, [route]);

  const skills = payload?.skills ?? [];
  const providers = unique(skills.map((skill) => skill.provider));
  const plugins = unique(skills.map((skill) => skill.pluginId));
  const sourceTypes = unique(skills.map((skill) => skill.sourceType));
  const warnings = payload?.warnings ?? [];
  const activeFilterCount = [provider !== "all", pluginId !== "all", sourceType !== "all"].filter(Boolean).length;
  const filtersDisabled = route.name !== "catalog";

  const countMatching = (nextFilter: Partial<Pick<Skill, "provider" | "pluginId" | "sourceType">>) =>
    skills.filter((skill) =>
      (!nextFilter.provider || skill.provider === nextFilter.provider) &&
      (!nextFilter.pluginId || skill.pluginId === nextFilter.pluginId) &&
      (!nextFilter.sourceType || skill.sourceType === nextFilter.sourceType)
    ).length;

  const clearFilters = () => {
    setProvider("all");
    setPluginId("all");
    setSourceType("all");
  };

  const filteredSkills = useMemo(
    () =>
      skills.filter((skill) =>
        (query ? includesQuery(skill, query) : true) &&
        (provider === "all" || skill.provider === provider) &&
        (pluginId === "all" || skill.pluginId === pluginId) &&
        (sourceType === "all" || skill.sourceType === sourceType)
      ),
    [skills, query, provider, pluginId, sourceType],
  );

  const totalPages = Math.max(1, Math.ceil(filteredSkills.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const visibleSkills = filteredSkills.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const detailSkill = filePayload?.skill ??
    skills.find((skill) => (route.name === "skill" || route.name === "uninstall") && skill.ref === route.ref) ??
    null;

  const copy = async (value: string) => {
    await navigator.clipboard?.writeText(value);
  };

  const copySelectedPreviewContent = async () => {
    const selectedText = window.getSelection()?.toString().trim();
    const content = selectedText || filePayload?.file?.content || "";
    if (!content) return;

    await copy(content);
    setCopiedSelection(true);
    window.setTimeout(() => setCopiedSelection(false), 1200);
  };

  const openUninstall = (skill: Skill) => {
    setUninstallDialog(skill.sourceType === "plugin" ? "blocked" : "confirm");
  };

  const confirmUninstall = async (skill: Skill) => {
    setUninstallDialog(null);
    setUninstallResult(null);
    setUninstallError(null);
    setUninstallSteps(initialUninstallSteps());
    setUninstallWorking(true);
    navigate({ name: "uninstall", ref: skill.ref });

    try {
      const request = (async () => {
        const response = await fetch(`/api/v1/skills/${encodeURIComponent(skill.ref)}/uninstall`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ confirmRef: skill.ref }),
        });
        const nextPayload = await response.json() as SkillUninstallPayload | { warnings?: SkillWarning[] };
        if (!response.ok) {
          const warning = nextPayload.warnings?.[0];
          throw new Error(warning?.message ?? `Uninstall returned ${response.status}`);
        }
        return nextPayload as SkillUninstallPayload;
      })();

      const [requestOutcome] = await Promise.allSettled([
        request,
        playUninstallProgress(setUninstallSteps),
      ]);

      if (requestOutcome.status === "rejected") {
        throw requestOutcome.reason;
      }

      const result = requestOutcome.value;
      setUninstallResult(result);
      setUninstallSteps(uninstallStepsAt(UNINSTALL_STEP_NAMES.length));
      await loadSkills();
    } catch (nextError) {
      setUninstallError(nextError instanceof Error ? nextError.message : String(nextError));
      setUninstallSteps((current) => {
        const runningIndex = current.findIndex((step) => step.status === "running");
        const completedCount = current.filter((step) => step.status === "completed").length;
        const failedIndex = runningIndex === -1
          ? Math.min(completedCount, UNINSTALL_STEP_NAMES.length - 1)
          : runningIndex;
        return uninstallStepsAt(failedIndex, failedIndex);
      });
    } finally {
      setUninstallWorking(false);
    }
  };

  return (
    <main className="app">
      <aside className="app-sidebar" aria-label="Catalog navigation">
        <button type="button" className="brand" onClick={() => navigate({ name: "catalog" })}>
          <span className="brand-mark" aria-hidden="true"><Layers size={18} /></span>
          <span>
            <h1>Skills Manager</h1>
            <p>Local skill catalog</p>
          </span>
        </button>

        <section className="sidebar-section" aria-label="Catalog status">
          <p className="sidebar-label">Status</p>
          <div className="sidebar-metrics">
            <span><strong>{payload?.count ?? 0}</strong> skills</span>
            <span><strong>{warnings.length}</strong> warnings</span>
            <span><strong>{filteredSkills.length}</strong> shown</span>
          </div>
        </section>

        <section className="sidebar-section" aria-label="Providers">
          <div className="sidebar-section-header">
            <p className="sidebar-label">Providers</p>
            {activeFilterCount > 0 ? (
              <button
                type="button"
                className="sidebar-clear"
                disabled={filtersDisabled}
                title={filtersDisabled ? "Filters are available in catalog view" : undefined}
                onClick={clearFilters}
              >
                Clear
              </button>
            ) : null}
          </div>
          <FilterButton
            active={provider === "all"}
            disabled={filtersDisabled}
            label="All providers"
            count={skills.length}
            onClick={() => setProvider("all")}
          />
          {providers.map((value) => (
            <FilterButton
              key={value}
              active={provider === value}
              disabled={filtersDisabled}
              label={value}
              count={countMatching({ provider: value })}
              onClick={() => setProvider(value)}
            />
          ))}
        </section>

        <section className="sidebar-section" aria-label="Source groups">
          <p className="sidebar-label">Sources</p>
          <FilterButton
            active={sourceType === "all"}
            disabled={filtersDisabled}
            label="All sources"
            count={skills.length}
            onClick={() => setSourceType("all")}
          />
          {sourceTypes.map((value) => (
            <FilterButton
              key={value}
              active={sourceType === value}
              disabled={filtersDisabled}
              label={value}
              count={countMatching({ sourceType: value })}
              onClick={() => setSourceType(value)}
            />
          ))}
        </section>

        {plugins.length > 0 ? (
          <section className="sidebar-section sidebar-section-scroll" aria-label="Plugins">
            <p className="sidebar-label">Plugins</p>
            <FilterButton
              active={pluginId === "all"}
              disabled={filtersDisabled}
              label="All plugins"
              count={skills.length}
              onClick={() => setPluginId("all")}
            />
            {plugins.map((value) => (
              <FilterButton
                key={value}
                active={pluginId === value}
                disabled={filtersDisabled}
                label={value}
                count={countMatching({ pluginId: value })}
                onClick={() => setPluginId(value)}
              />
            ))}
          </section>
        ) : null}
      </aside>

      <section className={`app-main ${route.name === "catalog" ? "catalog-view" : "detail-view"}`}>
        <header className="topbar">
          <div className="topbar-inner">
            <div>
              <p className="eyebrow">
                {route.name === "catalog" ? "Catalog" : route.name === "uninstall" ? "Uninstall" : "Skill Preview"}
              </p>
              <h2>
                {route.name === "catalog"
                  ? "Installed skills"
                  : route.name === "uninstall"
                    ? "Uninstall skill"
                    : detailSkill?.title ?? "Loading skill..."}
              </h2>
            </div>
            <div className="status-row" aria-label="Catalog status">
              <Badge variant="outline">local only</Badge>
              <Badge variant="outline">{activeFilterCount} filters</Badge>
              <Button type="button" variant="outline" size="sm" onClick={loadSkills}>
                <RefreshCw size={14} /> Refresh
              </Button>
            </div>
          </div>
        </header>

      {route.name === "catalog" ? (
        <>
          <section className="toolbar" aria-label="Skill filters">
            <label className="field">
              <Search size={17} aria-hidden="true" />
              <span className="sr-only">Search skills</span>
              <Input
                className="with-leading-icon"
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search skills, refs, paths"
              />
            </label>
            <Select value={provider} onValueChange={setProvider}>
              <SelectTrigger aria-label="Provider">
                <SelectValue placeholder="All providers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All providers</SelectItem>
                {providers.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={sourceType} onValueChange={setSourceType}>
              <SelectTrigger aria-label="Source">
                <SelectValue placeholder="All sources" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sources</SelectItem>
                {sourceTypes.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={pluginId} onValueChange={setPluginId}>
              <SelectTrigger aria-label="Plugin">
                <SelectValue placeholder="All plugins" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All plugins</SelectItem>
                {plugins.map((value) => <SelectItem key={value} value={value}>{value}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button type="button" variant="outline" onClick={clearFilters} disabled={activeFilterCount === 0}>
              Clear
            </Button>
          </section>

          <section className="catalog-shell">
            <div className="catalog-heading">
              <div>
                <p>{filteredSkills.length} matching skills</p>
              </div>
              <Badge variant="outline">{filteredSkills.length} shown</Badge>
            </div>

            {loading ? <div className="state">Loading skills...</div> : null}
            {error ? <div className="state" role="alert">Server error: {error}</div> : null}
            {!loading && !error && skills.length === 0 ? <div className="state">No skills found in the enabled provider roots.</div> : null}
            {!loading && !error && skills.length > 0 && filteredSkills.length === 0 ? <div className="state">No skills match the active filters.</div> : null}

            <div className="skill-list">
              {visibleSkills.map((skill) => (
                <SkillRow key={skill.ref} skill={skill} onOpen={(nextSkill) => navigate({ name: "skill", ref: nextSkill.ref })} />
              ))}
            </div>

            {filteredSkills.length > PAGE_SIZE ? (
              <nav className="pagination" aria-label="Skill pages">
                <Button type="button" variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>
                  Previous
                </Button>
                {Array.from({ length: totalPages }, (_, index) => index + 1).map((pageNumber) => (
                  <Button
                    key={pageNumber}
                    type="button"
                    variant={pageNumber === currentPage ? "default" : "outline"}
                    size="sm"
                    onClick={() => setPage(pageNumber)}
                    aria-current={pageNumber === currentPage ? "page" : undefined}
                  >
                    {pageNumber}
                  </Button>
                ))}
                <Button type="button" variant="outline" size="sm" disabled={currentPage === totalPages} onClick={() => setPage(currentPage + 1)}>
                  Next
                </Button>
              </nav>
            ) : null}

            {warnings.length > 0 ? (
              <Alert variant="warning">
                {warnings[0].message}{warnings.length > 1 ? ` (+${warnings.length - 1} more)` : ""}
              </Alert>
            ) : null}
          </section>
        </>
      ) : route.name === "uninstall" ? (
        <UninstallProgress
          result={uninstallResult}
          skill={detailSkill}
          steps={uninstallSteps}
          working={uninstallWorking}
          error={uninstallError}
          onBack={() => navigate({ name: "catalog" })}
        />
      ) : (
        <section className="detail-shell">
          <Button type="button" variant="outline" size="sm" className="back-button" onClick={() => navigate({ name: "catalog" })}>
            <ArrowLeft size={15} /> Catalog
          </Button>

          <section className="detail-hero">
            <div className="detail-title-block">
              {detailSkill?.description ? <p>{detailSkill.description}</p> : null}
            </div>
            {detailSkill ? (
              <div className="detail-actions">
                <Badge>{detailSkill.sourceType}</Badge>
                <Badge variant="outline"><Package size={13} /> {detailSkill.providerLabel}</Badge>
                {detailSkill.pluginId ? <Badge variant="outline">{detailSkill.pluginId}</Badge> : null}
                <Button variant="outline" size="sm" type="button" onClick={() => copy(detailSkill.ref)}><Copy size={14} /> ref</Button>
                <Button variant="outline" size="sm" type="button" onClick={() => copy(detailSkill.path)}><Copy size={14} /> path</Button>
                <Button
                  variant="outline"
                  size="sm"
                  type="button"
                  className="border-red-200 text-red-700 hover:border-red-300 hover:bg-red-50"
                  onClick={() => openUninstall(detailSkill)}
                >
                  <Trash2 size={14} /> Uninstall
                </Button>
              </div>
            ) : null}
            {detailSkill ? <p className="detail-path">{detailSkill.relativePath}</p> : null}
          </section>

          {error ? <div className="state" role="alert">Server error: {error}</div> : null}

          <Card className="detail-workspace">
            <section className="detail-grid" aria-label="Skill file browser and preview">
              <section className="files-panel" aria-label="Files">
              <CardHeader className="panel-header">
                <CardTitle>Files</CardTitle>
                <Badge variant="outline">{filePayload?.tree.length ?? 0}</Badge>
              </CardHeader>
              <CardContent className="files-content">
                {fileLoading && !filePayload ? <div className="state compact">Loading files...</div> : null}
                {filePayload ? (
                  <FileTree
                    entries={filePayload.tree}
                    selectedPath={selectedFilePath}
                    onSelect={(path) => route.name === "skill" ? void loadSkillFile(route.ref, path) : undefined}
                  />
                ) : null}
              </CardContent>
              </section>

              <section className="file-preview-panel" aria-label="File preview">
              <CardHeader className="preview-header">
                <div>
                  <CardTitle>{filePayload?.file?.name ?? selectedFilePath}</CardTitle>
                  <CardDescription>{detailSkill?.directory ?? ""}</CardDescription>
                </div>
                <div className="preview-actions">
                  {filePayload?.file ? <Badge variant="outline">{filePayload.file.kind}</Badge> : null}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={copySelectedPreviewContent}
                    disabled={!filePayload?.file}
                  >
                    {copiedSelection ? <Check size={14} /> : <Copy size={14} />}
                    {copiedSelection ? "copied" : "selection"}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="preview-content">
                {filePayload?.warnings?.map((warning) => (
                  <Alert key={`${warning.code}:${warning.path ?? warning.message}`} variant="warning">{warning.message}</Alert>
                ))}
                {fileLoading ? <div className="state compact">Loading preview...</div> : null}
                {!fileLoading && filePayload?.file?.kind === "markdown" ? (
                  <div className="markdown-frame">
                    <MarkdownPreview content={filePayload.file.content || "No preview content."} />
                  </div>
                ) : null}
                {!fileLoading && filePayload?.file?.kind === "text" ? (
                  <div className="markdown-frame">
                    <pre className="text-preview"><code>{filePayload.file.content}</code></pre>
                  </div>
                ) : null}
                {!fileLoading && filePayload?.file?.kind === "binary" ? (
                  <div className="state compact">Binary files cannot be previewed.</div>
                ) : null}
                {!fileLoading && !filePayload?.file ? (
                  <div className="state compact">Select a file to preview.</div>
                ) : null}
              </CardContent>
              </section>
            </section>
          </Card>
        </section>
      )}
      </section>
      {uninstallDialog && detailSkill ? (
        <UninstallDialog
          mode={uninstallDialog}
          skill={detailSkill}
          onCancel={() => setUninstallDialog(null)}
          onConfirm={() => void confirmUninstall(detailSkill)}
        />
      ) : null}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
