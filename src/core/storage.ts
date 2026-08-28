import type { SceneElementLike } from "./types";

export const STORAGE_KEY = "agent-canvas.workspace.v2";

export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): unknown;
  removeItem(key: string): unknown;
}

export interface PersistedWorkspace<
  T extends SceneElementLike = SceneElementLike,
> {
  elements: T[];
  savedAt: number;
}

interface StorageEnvelope<T extends SceneElementLike> {
  version: 2;
  workspace: PersistedWorkspace<T>;
}

export function saveWorkspace<T extends SceneElementLike>(
  storage: StorageAdapter,
  workspace: PersistedWorkspace<T>,
): void {
  const envelope: StorageEnvelope<T> = { version: 2, workspace };
  storage.setItem(STORAGE_KEY, JSON.stringify(envelope));
}

export function loadWorkspace<T extends SceneElementLike>(
  storage: StorageAdapter,
): PersistedWorkspace<T> | null {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const envelope = JSON.parse(raw) as Partial<StorageEnvelope<T>>;
    if (
      envelope.version !== 2 ||
      !envelope.workspace ||
      !Array.isArray(envelope.workspace.elements)
    ) {
      return null;
    }
    return envelope.workspace;
  } catch {
    return null;
  }
}
