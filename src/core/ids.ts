export function stableId(prefix: string, ...parts: readonly unknown[]): string {
  const source = parts
    .map((part) =>
      typeof part === "string" ? part : JSON.stringify(sortObject(part)),
    )
    .join("|");

  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return `${prefix}_${(hash >>> 0).toString(36)}`;
}

function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortObject);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortObject(entry)]),
    );
  }
  return value;
}
