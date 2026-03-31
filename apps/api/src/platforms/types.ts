export type PlatformId = "twitch" | "kick" | "telegram";

export interface TaskLike {
  id: string;
  platform: string;
  validationType: string;
  meta?: unknown;
}

export interface PlatformProvider {
  id: PlatformId;
  verifyTask(userId: string, task: TaskLike): Promise<boolean>;
}
