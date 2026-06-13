import { Context, Effect, Layer, Schema } from "effect";

import {
  NormalizedSkillSchema,
  type NormalizedSkill,
  type ProviderInfo,
  type SkillWarning,
  type SkillsPayload,
} from "../domain";
import { homeDir as defaultHomeDir, normalizePath } from "../path-utils";
import { getDefaultProvider } from "../providers/registry";
import type { SkillProvider } from "../providers/types";

export type CatalogOptions = {
  homeDir?: string;
  providers?: readonly string[];
  rootsByProvider?: Record<string, readonly string[]>;
};

export type CatalogSnapshot = SkillsPayload & {
  apiVersion: 1;
  schemaVersion: 2;
  providerInfos: ProviderInfo[];
};

function skillSort(left: NormalizedSkill, right: NormalizedSkill): number {
  return (
    left.provider.localeCompare(right.provider) ||
    left.sourceType.localeCompare(right.sourceType) ||
    (left.pluginId ?? "").localeCompare(right.pluginId ?? "") ||
    left.name.localeCompare(right.name) ||
    left.ref.localeCompare(right.ref)
  );
}

function duplicateWarnings(skills: NormalizedSkill[]): {
  skills: NormalizedSkill[];
  warnings: SkillWarning[];
} {
  const grouped = new Map<string, NormalizedSkill[]>();
  for (const skill of skills) {
    const existing = grouped.get(skill.ref) ?? [];
    existing.push(skill);
    grouped.set(skill.ref, existing);
  }

  const warnings: SkillWarning[] = [];
  const unique: NormalizedSkill[] = [];

  for (const [ref, matchingSkills] of grouped) {
    if (matchingSkills.length === 1) {
      unique.push(matchingSkills[0]);
      continue;
    }

    for (const skill of matchingSkills) {
      warnings.push({
        code: "DuplicateSkillRef",
        provider: skill.provider,
        ref,
        message: `Duplicate skill ref skipped: ${ref}`,
      });
    }
  }

  return { skills: unique.sort(skillSort), warnings };
}

export async function collectProviderSkills({
  homeDir = defaultHomeDir(),
  providers = ["codex"],
  rootsByProvider = {},
}: CatalogOptions = {}): Promise<CatalogSnapshot> {
  const allSkills: NormalizedSkill[] = [];
  const warnings: SkillWarning[] = [];
  const roots: string[] = [];
  const providerInfos: ProviderInfo[] = [];

  for (const providerId of providers) {
    const provider = getDefaultProvider(providerId);
    if (!provider) {
      warnings.push({
        code: "InvalidProviderConfig",
        provider: providerId,
        message: `Provider is not registered: ${providerId}`,
      });
      providerInfos.push({ id: providerId, label: providerId, enabled: false, roots: [], warnings: [] });
      continue;
    }

    const providerRoots = rootsByProvider[provider.id]?.map(normalizePath);
    const discovery = await Effect.runPromise(
      provider.discover({ homeDir, roots: providerRoots }),
    );
    const providerWarnings = [...discovery.warnings];
    roots.push(...discovery.roots);

    for (const entry of discovery.entries) {
      const result = await Effect.runPromiseExit(provider.parse(entry, { homeDir, roots: providerRoots }));
      if (result._tag === "Failure") {
        providerWarnings.push({
          code: "SkillParseError",
          provider: provider.id,
          path: entry.path,
          message: "Failed to parse skill.",
        });
        continue;
      }

      const skill = result.value;
      try {
        Schema.decodeUnknownSync(NormalizedSkillSchema)(skill);
        allSkills.push(skill);
      } catch (error) {
        providerWarnings.push({
          code: "SkillParseError",
          provider: provider.id,
          path: entry.path,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    providerInfos.push({
      id: provider.id,
      label: provider.label,
      enabled: true,
      roots: discovery.roots,
      warnings: providerWarnings,
    });
    warnings.push(...providerWarnings);
  }

  const deduped = duplicateWarnings(allSkills);
  warnings.push(...deduped.warnings);

  return {
    apiVersion: 1,
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    roots: [...new Set(roots)].sort(),
    count: deduped.skills.length,
    skills: deduped.skills,
    warnings,
    providerInfos,
  };
}

export class SkillCatalog extends Context.Service<SkillCatalog, {
  readonly collect: (options?: CatalogOptions) => Effect.Effect<CatalogSnapshot>;
}>()("skills-manager/catalog/SkillCatalog") {
  static readonly layer = Layer.succeed(
    SkillCatalog,
    SkillCatalog.of({
      collect: (options) => Effect.promise(() => collectProviderSkills(options)),
    }),
  );
}

export function findSkillByRef(snapshot: CatalogSnapshot, ref: string): NormalizedSkill | undefined {
  return snapshot.skills.find((skill) => skill.ref === ref || skill.legacyRef === ref);
}
