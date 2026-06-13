import { BunRuntime, BunServices } from "@effect/platform-bun";
import { Console, Effect } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { resolveConfig } from "../config";
import { writeSkillsFileV1, watchSkillsFile } from "../catalog/SkillIndexWriter";
import { dashboardServerResource } from "../server/DashboardServer";

const packageJson = await Bun.file(new URL("../../package.json", import.meta.url)).json();

const providerFlag = Flag.string("provider").pipe(
  Flag.withDescription("Enable a provider id. Can be passed more than once."),
  Flag.atMost(32),
  Flag.withDefault([]),
);

const rootFlag = Flag.string("root").pipe(
  Flag.withDescription("Override enabled provider roots. Can be passed more than once."),
  Flag.atMost(128),
  Flag.withDefault([]),
);

const outputFlag = Flag.string("output").pipe(
  Flag.withDescription("Output JSON path for sync/watch."),
  Flag.withDefault(""),
);

const hostFlag = Flag.string("host").pipe(
  Flag.withDescription("Host to bind the local dashboard server."),
  Flag.withDefault("127.0.0.1"),
);

const portFlag = Flag.integer("port").pipe(
  Flag.withDescription("Port to bind the local dashboard server."),
  Flag.withDefault(3737),
);

function normalizeList(values: readonly string[]): string[] | undefined {
  return values.length > 0 ? [...values] : undefined;
}

function normalizeOutput(value: string): string | undefined {
  return value ? value : undefined;
}

const root = Command.make("skillsmanager").pipe(
  Command.withDescription("Preview and index installed agent skills."),
);

const sync = Command.make(
  "sync",
  {
    provider: providerFlag,
    root: rootFlag,
    output: outputFlag,
  },
  ({ provider, root, output }) =>
    Effect.promise(async () => {
      const config = await resolveConfig({
        providers: normalizeList(provider),
        roots: normalizeList(root),
        outputPath: normalizeOutput(output),
      });
      const payload = await writeSkillsFileV1(config);
      console.log(`Recorded ${payload.count} skills in ${config.outputPath}`);
    }),
).pipe(Command.withDescription("Write the skills JSON index and exit."));

const watch = Command.make(
  "watch",
  {
    provider: providerFlag,
    root: rootFlag,
    output: outputFlag,
  },
  ({ provider, root, output }) =>
    Effect.scoped(Effect.gen(function*() {
      const config = yield* Effect.promise(() =>
        resolveConfig({
          providers: normalizeList(provider),
          roots: normalizeList(root),
          outputPath: normalizeOutput(output),
        })
      );
      const stop = yield* Effect.acquireRelease(
        Effect.promise(() => watchSkillsFile(config)),
        (release) => Effect.sync(() => release()),
      );
      yield* Console.log(`Watching skill roots. Press Ctrl+C to stop.`);
      void stop;
      yield* Effect.never;
    })),
).pipe(Command.withDescription("Watch skill roots and rewrite the JSON index."));

const dev = Command.make(
  "dev",
  {
    provider: providerFlag,
    root: rootFlag,
    host: hostFlag,
    port: portFlag,
  },
  ({ provider, root, host, port }) =>
    Effect.scoped(Effect.gen(function*() {
      if (port < 1 || port > 65535) {
        throw new Error(`Invalid port: ${port}`);
      }
      const config = yield* Effect.promise(() =>
        resolveConfig({
          providers: normalizeList(provider),
          roots: normalizeList(root),
          host,
          port,
        })
      );
      const server = yield* dashboardServerResource(config);
      const snapshot = yield* Effect.promise(() =>
        fetch(`${server.url}/api/v1/health`).then((response) => response.json())
      );
      yield* Console.log(`Skills Manager dashboard: ${server.url}`);
      yield* Console.log(
        `Providers: ${config.providers.join(", ")} | Skills: ${snapshot.skillCount} | Warnings: ${snapshot.warningCount}`,
      );
      yield* Effect.never;
    })),
).pipe(Command.withDescription("Start the local dashboard server."));

export const skillsManagerCommand = root.pipe(Command.withSubcommands([dev, sync, watch]));

export const runCli = (args?: readonly string[]) => {
  const program = args
    ? Command.runWith(skillsManagerCommand, { version: packageJson.version })(args)
    : Command.run(skillsManagerCommand, { version: packageJson.version });

  return program.pipe(Effect.provide(BunServices.layer));
};

export function main(): void {
  BunRuntime.runMain(runCli(), { disableErrorReporting: false });
}

if (import.meta.main) {
  main();
}
