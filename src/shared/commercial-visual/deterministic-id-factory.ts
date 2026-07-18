export interface DeterministicIdFactory {
  id(namespace: string, ...semanticPath: unknown[]): string;
}

function stableHash(value: string): string {
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second ^ code, 0x85ebca6b);
  }
  return `${(first >>> 0).toString(36)}${(second >>> 0).toString(36)}`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalize(child)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function createDeterministicIdFactory(scope: string): DeterministicIdFactory {
  return {
    id(namespace, ...semanticPath) {
      return `${namespace}-${stableHash(canonicalJson([scope, namespace, ...semanticPath]))}`;
    },
  };
}

export function canonicalPresentationHash(value: unknown): string {
  return `cv2-${stableHash(canonicalJson(value))}`;
}
