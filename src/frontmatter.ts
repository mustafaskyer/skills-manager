import type { MetadataValue } from "./path-utils";

function parseScalar(value: string): MetadataValue {
  const trimmed = value.trim();

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  if (trimmed === "true") return true;
  if (trimmed === "false") return false;

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((item) => parseScalar(item))
      .filter((item) => item !== "");
  }

  return trimmed;
}

export function parseFrontmatter(markdown: string): {
  data: Record<string, MetadataValue>;
  body: string;
} {
  if (!markdown.startsWith("---\n")) {
    return { data: {}, body: markdown };
  }

  const endIndex = markdown.indexOf("\n---", 4);
  if (endIndex === -1) {
    return { data: {}, body: markdown };
  }

  const rawFrontmatter = markdown.slice(4, endIndex);
  const body = markdown.slice(endIndex).replace(/^\n---\r?\n?/, "");
  const data: Record<string, MetadataValue> = {};

  for (const line of rawFrontmatter.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separatorIndex = trimmed.indexOf(":");
    if (separatorIndex === -1) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1);
    data[key] = parseScalar(value);
  }

  return { data, body };
}

export function firstHeading(markdown: string): string {
  const match = markdown.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : "";
}

export function firstParagraph(markdown: string): string {
  const withoutHeadings = markdown
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");

  const match = withoutHeadings.match(/(?:^|\n)([^\n`>-][^\n]+(?:\n[^\n`>-][^\n]+)*)/);
  return match ? match[1].replace(/\s+/g, " ").trim() : "";
}
