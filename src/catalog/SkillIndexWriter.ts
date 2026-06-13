import { Context, Effect, Layer } from "effect";

import { collectProviderSkills, type CatalogOptions } from "./SkillCatalog";
import { ensureParentDirectory } from "../path-utils";

export type WriteIndexOptions = CatalogOptions & {
  outputPath: string;
};

export type WatchIndexOptions = WriteIndexOptions & {
  intervalMs?: number;
};

export async function writeSkillsFileV1(options: WriteIndexOptions) {
  const snapshot = await collectProviderSkills(options);
  const payload = {
    schemaVersion: 1 as const,
    generatedAt: snapshot.generatedAt,
    roots: snapshot.roots,
    count: snapshot.count,
    skills: snapshot.skills.map(({ legacyRef, provider, providerLabel, sourceType, pluginId, ...skill }) => ({
      ...skill,
      ref: legacyRef,
      source: sourceType,
      provider,
      providerLabel,
      sourceType,
      pluginId,
      legacyRef,
    })),
    warnings: snapshot.warnings,
  };

  await ensureParentDirectory(options.outputPath);
  await Bun.write(options.outputPath, `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

async function snapshotKey(options: CatalogOptions): Promise<string> {
  const snapshot = await collectProviderSkills(options);
  return snapshot.skills
    .map((skill) => `${skill.path}:${skill.ref}`)
    .sort()
    .join("\n");
}

export async function watchSkillsFile(options: WatchIndexOptions): Promise<() => void> {
  const intervalMs = options.intervalMs ?? 250;
  let stopped = false;
  let current = await snapshotKey(options);

  const sync = async () => {
    const payload = await writeSkillsFileV1(options);
    console.log(`Recorded ${payload.count} skills in ${options.outputPath}`);
  };

  await sync();

  void (async () => {
    while (!stopped) {
      await Bun.sleep(intervalMs);
      if (stopped) break;

      try {
        const next = await snapshotKey(options);
        if (next === current) continue;
        current = next;
        await sync();
      } catch (error) {
        console.error(error);
      }
    }
  })();

  return () => {
    stopped = true;
  };
}

export class SkillIndexWriter extends Context.Service<SkillIndexWriter, {
  readonly write: (options: WriteIndexOptions) => Effect.Effect<Awaited<ReturnType<typeof writeSkillsFileV1>>>;
  readonly watch: (options: WatchIndexOptions) => Effect.Effect<() => void>;
}>()("skills-manager/catalog/SkillIndexWriter") {
  static readonly layer = Layer.succeed(
    SkillIndexWriter,
    SkillIndexWriter.of({
      write: (options) => Effect.promise(() => writeSkillsFileV1(options)),
      watch: (options) => Effect.promise(() => watchSkillsFile(options)),
    }),
  );
}
