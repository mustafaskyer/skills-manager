import { Context, Schema } from "effect";

import type { MetadataValue } from "./path-utils";

export type WarningCode =
  | "ProviderRootMissing"
  | "SkillParseError"
  | "DuplicateSkillRef"
  | "InvalidProviderConfig"
  | "ServerStartError"
  | "PreviewReadError"
  | "PreviewTooLarge"
  | "SkillUninstallError";

export type SkillWarning = {
  code: WarningCode;
  provider?: string;
  ref?: string;
  path?: string;
  message: string;
};

export type NormalizedSkill = {
  ref: string;
  legacyRef: string;
  provider: string;
  providerLabel: string;
  sourceType: string;
  name: string;
  title: string;
  description: string;
  version: MetadataValue | null;
  allowedTools: MetadataValue | null;
  sourceRoot: string | null;
  pluginId: string | null;
  relativePath: string;
  path: string;
  directory: string;
  metadata: Record<string, MetadataValue>;
};

export type SkillUninstallStepName = "locating repo" | "removing" | "checking" | "removed";

export type SkillUninstallStep = {
  name: SkillUninstallStepName;
  status: "pending" | "running" | "completed" | "failed";
  message: string;
};

export type SkillUninstallResult = {
  apiVersion: 1;
  skill: NormalizedSkill;
  steps: SkillUninstallStep[];
  removedPaths: string[];
  lockUpdated: boolean;
  warnings: SkillWarning[];
};

export type SkillsPayload = {
  apiVersion?: 1;
  schemaVersion: 1 | 2;
  generatedAt: string;
  roots: string[];
  count: number;
  skills: NormalizedSkill[];
  warnings?: SkillWarning[];
};

export type ProviderInfo = {
  id: string;
  label: string;
  enabled: boolean;
  roots: string[];
  warnings: SkillWarning[];
};

export const MetadataValueSchema = Schema.Union([
  Schema.String,
  Schema.Boolean,
  Schema.Array(Schema.Union([Schema.String, Schema.Boolean])),
]);

export const SkillWarningSchema = Schema.Struct({
  code: Schema.String,
  provider: Schema.UndefinedOr(Schema.String),
  ref: Schema.UndefinedOr(Schema.String),
  path: Schema.UndefinedOr(Schema.String),
  message: Schema.String,
});

export const NormalizedSkillSchema = Schema.Struct({
  ref: Schema.String,
  legacyRef: Schema.String,
  provider: Schema.String,
  providerLabel: Schema.String,
  sourceType: Schema.String,
  name: Schema.String,
  title: Schema.String,
  description: Schema.String,
  version: Schema.NullOr(MetadataValueSchema),
  allowedTools: Schema.NullOr(MetadataValueSchema),
  sourceRoot: Schema.NullOr(Schema.String),
  pluginId: Schema.NullOr(Schema.String),
  relativePath: Schema.String,
  path: Schema.String,
  directory: Schema.String,
  metadata: Schema.Record(Schema.String, MetadataValueSchema),
});

export class ProviderRootMissing extends Schema.TaggedErrorClass<ProviderRootMissing>()(
  "ProviderRootMissing",
  {
    provider: Schema.String,
    path: Schema.String,
    message: Schema.String,
  },
) {}

export class SkillParseError extends Schema.TaggedErrorClass<SkillParseError>()("SkillParseError", {
  provider: Schema.String,
  path: Schema.String,
  message: Schema.String,
}) {}

export class DuplicateSkillRef extends Schema.TaggedErrorClass<DuplicateSkillRef>()("DuplicateSkillRef", {
  provider: Schema.String,
  ref: Schema.String,
  message: Schema.String,
}) {}

export class InvalidProviderConfig extends Schema.TaggedErrorClass<InvalidProviderConfig>()(
  "InvalidProviderConfig",
  {
    provider: Schema.String,
    message: Schema.String,
  },
) {}

export class ServerStartError extends Schema.TaggedErrorClass<ServerStartError>()("ServerStartError", {
  host: Schema.String,
  port: Schema.Number,
  message: Schema.String,
}) {}

export class PreviewReadError extends Schema.TaggedErrorClass<PreviewReadError>()("PreviewReadError", {
  ref: Schema.String,
  message: Schema.String,
}) {}

export class AppConfig extends Context.Service<AppConfig, {
  readonly homeDir: string;
  readonly providers: readonly string[];
  readonly host: string;
  readonly port: number;
  readonly outputPath: string;
  readonly rootsByProvider: Record<string, readonly string[]>;
}>()("skills-manager/config/AppConfig") {}
