export interface SceneElementLike {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle?: number;
  version?: number;
  versionNonce?: number;
  updated?: number;
  isDeleted?: boolean;
  locked?: boolean;
  strokeColor?: string;
  backgroundColor?: string;
  frameId?: string | null;
  boundElements?: readonly { id: string; type: string }[] | null;
  customData?: Record<string, unknown>;
  [key: string]: unknown;
}
