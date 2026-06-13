import { expect, test } from "bun:test";

import { BunRuntime } from "@effect/platform-bun";
import { Context, Effect, Layer, Schema } from "effect";
import { Command, Flag } from "effect/unstable/cli";

test("effect v4 imports used by the CLI and services are available", () => {
  class TestService extends Context.Service<TestService, { readonly value: number }>()(
    "skills-manager/test/TestService",
  ) {}

  const schema = Schema.Struct({ ok: Schema.Boolean });
  const decoded = Schema.decodeSync(schema)({ ok: true });
  const command = Command.make(
    "skillsmanager",
    { port: Flag.integer("port").pipe(Flag.withDefault(3737)) },
    ({ port }) => Effect.succeed(port),
  );
  const layer = Layer.succeed(TestService, TestService.of({ value: 1 }));

  expect(decoded).toEqual({ ok: true });
  expect(command.name).toBe("skillsmanager");
  expect(layer).toBeDefined();
  expect(BunRuntime.runMain).toBeFunction();
});
