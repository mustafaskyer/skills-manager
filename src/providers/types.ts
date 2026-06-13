import type { Effect } from "effect";

import type { NormalizedSkill, SkillParseError, SkillUninstallResult, SkillWarning } from "../domain";

export type ProviderContext = {
  homeDir: string;
  roots?: readonly string[];
};

export type ProviderSkillEntry = {
  provider: string;
  sourceRoot: string | null;
  relativePath: string;
  path: string;
  directory: string;
  sourceType: string;
  pluginId: string | null;
};

export type ProviderDiscovery = {
  entries: ProviderSkillEntry[];
  roots: string[];
  warnings: SkillWarning[];
};

export type SkillProvider = {
  id: string;
  label: string;
  defaultRoots: (homeDir: string) => string[];
  discover: (context: ProviderContext) => Effect.Effect<ProviderDiscovery>;
  parse: (
    entry: ProviderSkillEntry,
    context: ProviderContext,
  ) => Effect.Effect<NormalizedSkill, SkillParseError>;
  uninstall?: (
    skill: NormalizedSkill,
    context: ProviderContext,
  ) => Effect.Effect<SkillUninstallResult>;
};
