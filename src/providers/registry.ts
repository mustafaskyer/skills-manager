import { Context, Layer } from "effect";

import { CodexProvider } from "./codex/CodexProvider";
import type { SkillProvider } from "./types";

export class ProviderRegistry extends Context.Service<ProviderRegistry, {
  readonly providers: readonly SkillProvider[];
  readonly get: (id: string) => SkillProvider | undefined;
}>()("skills-manager/providers/ProviderRegistry") {
  static readonly layer = (providers: readonly SkillProvider[] = [CodexProvider]) =>
    Layer.succeed(
      ProviderRegistry,
      ProviderRegistry.of({
        providers,
        get: (id) => providers.find((provider) => provider.id === id),
      }),
    );
}

export const defaultProviders = [CodexProvider] as const;

export function getDefaultProvider(id: string): SkillProvider | undefined {
  return defaultProviders.find((provider) => provider.id === id);
}
