import { and, eq, gt, inArray, or, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  platformAccounts,
  referrals,
  taskEvidence,
  taskStreamMessages,
  tasks,
  transactions,
  userBalances,
  userStreamStreaks,
  userTasks,
} from "../db/schema.js";
import { utcDateString } from "./streak.js";
import { canCompletePlatformTask } from "../platforms/registry.js";
import { computeLevel, computeRewardMultiplier } from "../config.js";
import { maybeQualifyReferral } from "./referrals.js";
import { applyCredit, applyCreditSplit } from "./economy.js";
import { reverseTaskRewardCredit } from "./taskRewardCompensation.js";
import { getTaskVerifyQueue } from "../queue/bullmq.js";
import { processVerifyTaskJob } from "../workers/verifyTaskProcessor.js";
import type { TaskDto, UserTaskStatus } from "shared";
import {
  extractCoverImageMedia,
  extractCoverImageUrl,
  extractEvidenceExamples,
  extractTaskUiFields,
} from "./taskUiMeta.js";
import { verifyPlatformTask } from "./taskVerifyLogic.js";
import { singleFlight } from "../lib/singleFlight.js";
import {
  getActiveTasksCached,
  type CachedTaskRow,
} from "./taskCatalogCache.js";
import {
  getCachedUserTaskDtoList,
  invalidateUserTaskDtoCache,
  setCachedUserTaskDtoList,
} from "./taskUserListCache.js";

function periodKeyForTask(task: { type: string }): string {
  if (task.type === "daily") return utcDateString();
  return "once";
}

type ProgressSnapshot = {
  referralsTotal: number;
  twitchStreak: number;
  kickStreak: number;
  linkedTwitch: boolean;
  linkedKick: boolean;
  twitchMessages: number;
  kickMessages: number;
};

function toTaskMeta(taskMeta: unknown): Record<string, unknown> {
  if (taskMeta && typeof taskMeta === "object") return taskMeta as Record<string, unknown>;
  return {};
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v : null;
}

function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function evidenceStageFromMeta(meta: Record<string, unknown>): number {
  const stageRaw = asNumber(meta.hardStageCurrent);
  return stageRaw != null ? Math.max(1, Math.floor(stageRaw) + 1) : 1;
}

/** Номер этапа в `task_evidence.stage` для этого задания (1-based). */
function evidenceStageForTask(meta: Record<string, unknown>): number {
  const co = asNumber(meta.chainOrder);
  if (co != null && co >= 1) return Math.floor(co);
  return evidenceStageFromMeta(meta);
}

/** Ключи meta, уже поднятые в корень TaskDto — не дублируем в ответе GET /tasks. */
const META_KEYS_HOISTED_TO_ROOT = new Set([
  "actionUrl",
  "actionLabel",
  "verifyLabel",
  "help",
  "chainKey",
  "chainOrder",
  "hard",
  "hardStageCurrent",
  "hardStageTotal",
  "uiSection",
  "uiOrder",
  "requiresEvidence",
  "evidenceExamples",
  "progressSource",
  "targetValue",
  "progressLabel",
  "coverImageUrl",
  "coverImageMedia",
]);

function slimMetaForTaskList(meta: Record<string, unknown>): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (META_KEYS_HOISTED_TO_ROOT.has(k)) continue;
    out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function filterTasksForPlatform(
  list: TaskDto[],
  platform: string
): TaskDto[] {
  if (platform === "twitch" || platform === "kick") {
    return list.filter(
      (t) =>
        t.platform === platform ||
        t.platform === "global" ||
        t.platform === "telegram"
    );
  }
  if (platform === "global") {
    return list.filter((t) => t.platform === "global");
  }
  return list;
}

function readProgress(
  meta: Record<string, unknown>,
  snapshot: ProgressSnapshot
): { current: number; target: number; label: string | null } | null {
  const source = asString(meta.progressSource);
  const targetRaw = asNumber(meta.targetValue);
  if (!source || !targetRaw || targetRaw <= 0) return null;
  const target = Math.floor(targetRaw);
  let current = 0;
  let label: string | null = null;
  if (source === "referrals_total") {
    current = snapshot.referralsTotal;
    label = "Приглашено";
  } else if (source === "streak_twitch") {
    current = snapshot.twitchStreak;
    label = "Стрик Twitch";
  } else if (source === "streak_kick") {
    current = snapshot.kickStreak;
    label = "Стрик Kick";
  } else if (source === "linked_twitch") {
    current = snapshot.linkedTwitch ? 1 : 0;
    label = "Привязка Twitch";
  } else if (source === "linked_kick") {
    current = snapshot.linkedKick ? 1 : 0;
    label = "Привязка Kick";
  } else if (source === "stream_messages_twitch") {
    current = snapshot.twitchMessages;
    label = "Сообщения";
  } else if (source === "stream_messages_kick") {
    current = snapshot.kickMessages;
    label = "Сообщения";
  } else {
    return null;
  }
  const customLabel = asString(meta.progressLabel);
  if (customLabel) label = customLabel;
  return { current, target, label };
}

async function buildProgressSnapshot(userId: string): Promise<ProgressSnapshot> {
  const [refRows, streakRows, linked, twRows, kickRows] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(referrals)
      .where(eq(referrals.referrerId, userId)),
    db
      .select({
        twitchCurrent: userStreamStreaks.twitchCurrent,
        kickCurrent: userStreamStreaks.kickCurrent,
      })
      .from(userStreamStreaks)
      .where(eq(userStreamStreaks.userId, userId))
      .limit(1),
    db
      .select({ platform: platformAccounts.platform })
      .from(platformAccounts)
      .where(eq(platformAccounts.userId, userId)),
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(taskStreamMessages)
      .where(
        and(
          eq(taskStreamMessages.userId, userId),
          eq(taskStreamMessages.platform, "twitch")
        )
      ),
    db
      .select({ c: sql<number>`count(*)::int` })
      .from(taskStreamMessages)
      .where(
        and(
          eq(taskStreamMessages.userId, userId),
          eq(taskStreamMessages.platform, "kick")
        )
      ),
  ]);
  const refRow = refRows[0];
  const streak = streakRows[0];
  const twMsg = twRows[0];
  const kickMsg = kickRows[0];
  const linkedSet = new Set(linked.map((r) => r.platform));
  return {
    referralsTotal: refRow?.count ?? 0,
    twitchStreak: streak?.twitchCurrent ?? 0,
    kickStreak: streak?.kickCurrent ?? 0,
    linkedTwitch: linkedSet.has("twitch"),
    linkedKick: linkedSet.has("kick"),
    twitchMessages: twMsg?.c ?? 0,
    kickMessages: kickMsg?.c ?? 0,
  };
}

function userTaskMapKey(taskId: string, periodKey: string): string {
  return `${taskId}\0${periodKey}`;
}

/** Порядок секций в списке заданий (meta.uiSection). */
const SECTION_UI_RANK: Record<string, number> = {
  black_russia: 0,
  stream_tasks: 1,
  twitch: 2,
  kick: 3,
  telegram: 4,
  global: 5,
};

function rewardPlatformLabel(taskPlatform: string): "twitch" | "kick" | "split" {
  if (taskPlatform === "twitch") return "twitch";
  if (taskPlatform === "kick") return "kick";
  return "split";
}

async function enforceTaskRevocationIfNeeded(
  userId: string,
  taskRow: typeof tasks.$inferSelect,
  periodKey: string
): Promise<void> {
  const meta = toTaskMeta(taskRow.meta);
  if (meta.revokeOnUnsubscribe !== true) return;
  const [ut] = await db
    .select()
    .from(userTasks)
    .where(
      and(
        eq(userTasks.userId, userId),
        eq(userTasks.taskId, taskRow.id),
        eq(userTasks.periodKey, periodKey),
        eq(userTasks.status, "completed"),
        gt(userTasks.rewardGranted, 0)
      )
    )
    .limit(1);
  if (!ut) return;

  const verify = await verifyPlatformTask(userId, taskRow);
  if (verify.ok) return;

  let revoked = false;
  await db.transaction(async (tx) => {
    const [fresh] = await tx
      .select()
      .from(userTasks)
      .where(eq(userTasks.id, ut.id))
      .limit(1);
    if (!fresh || fresh.status !== "completed" || (fresh.rewardGranted ?? 0) <= 0) return;
    const revokeKey = `task_revoke:${userId}:${taskRow.id}:${periodKey}`;
    const [dup] = await tx
      .select({ id: transactions.id })
      .from(transactions)
      .where(eq(transactions.idempotencyKey, revokeKey))
      .limit(1);
    if (dup) return;

    const [bal] = await tx
      .select({
        coins: userBalances.coins,
        twitchCoins: userBalances.twitchCoins,
        kickCoins: userBalances.kickCoins,
      })
      .from(userBalances)
      .where(eq(userBalances.userId, userId))
      .limit(1);
    if (!bal) return;

    const granted = fresh.rewardGranted ?? 0;
    const p = fresh.rewardPlatform ?? rewardPlatformLabel(taskRow.platform);
    const twNeed = p === "twitch" ? granted : p === "split" ? Math.floor(granted / 2) : 0;
    const kickNeed = p === "kick" ? granted : p === "split" ? granted - Math.floor(granted / 2) : 0;
    const twDeduct = Math.max(0, Math.min(bal.twitchCoins ?? 0, twNeed));
    const kickDeduct = Math.max(0, Math.min(bal.kickCoins ?? 0, kickNeed));
    const totalDeduct = twDeduct + kickDeduct;
    if (totalDeduct > 0) {
      await tx.insert(transactions).values({
        userId,
        amount: -totalDeduct,
        kind: "task_revoke",
        referenceType: "task",
        referenceId: taskRow.id,
        idempotencyKey: revokeKey,
        meta: { reason: verify.reason, twDeduct, kickDeduct },
      });
      await tx
        .update(userBalances)
        .set({
          twitchCoins: sql`${userBalances.twitchCoins} - ${twDeduct}`,
          kickCoins: sql`${userBalances.kickCoins} - ${kickDeduct}`,
          coins: sql`${userBalances.coins} - ${totalDeduct}`,
        })
        .where(eq(userBalances.userId, userId));
    }
    await tx
      .update(userTasks)
      .set({
        status: "available",
        lastError: "revoked_unsubscribed",
        rewardGranted: 0,
        rewardPlatform: null,
        updatedAt: sql`now()`,
      })
      .where(eq(userTasks.id, fresh.id));
    revoked = true;
  });
  if (revoked) invalidateUserTaskDtoCache(userId);
}

/** Не распараллеливать десятки revoke-транзакций — упираемся в пул Postgres. */
async function runRevocationChecksBatched(
  userId: string,
  taskRows: (typeof tasks.$inferSelect)[]
): Promise<void> {
  const revokeTasks = taskRows.filter(
    (t) => toTaskMeta(t.meta).revokeOnUnsubscribe === true
  );
  const batch = 5;
  for (let i = 0; i < revokeTasks.length; i += batch) {
    const slice = revokeTasks.slice(i, i + batch);
    await Promise.all(
      slice.map((t) =>
        enforceTaskRevocationIfNeeded(userId, t, periodKeyForTask(t))
      )
    );
  }
}

async function computeUserTaskDtoList(
  userId: string,
  all: CachedTaskRow[]
): Promise<TaskDto[]> {
  const again = await getCachedUserTaskDtoList(userId);
  if (again) return again;

  const todayPk = utcDateString();
  const allTaskIds = [...new Set(all.map((x) => x.id))];
  const [progressSnapshot, userTaskRows] = await Promise.all([
    buildProgressSnapshot(userId),
    allTaskIds.length === 0
      ? Promise.resolve([] as (typeof userTasks.$inferSelect)[])
      : db
          .select()
          .from(userTasks)
          .where(
            and(
              eq(userTasks.userId, userId),
              inArray(userTasks.taskId, allTaskIds),
              or(eq(userTasks.periodKey, todayPk), eq(userTasks.periodKey, "once"))
            )
          ),
  ]);

  const utMap = new Map<string, typeof userTasks.$inferSelect>();
  for (const r of userTaskRows) {
    const pk = r.periodKey ?? "";
    utMap.set(userTaskMapKey(r.taskId, pk), r);
  }
  const getUt = (taskId: string, periodKey: string) =>
    utMap.get(userTaskMapKey(taskId, periodKey));

  const chainTasks = new Map<string, Array<(typeof all)[number]>>();
  const standaloneTasks: Array<(typeof all)[number]> = [];
  for (const t of all) {
    const meta = toTaskMeta(t.meta);
    const chainKey = asString(meta.chainKey);
    if (!chainKey) {
      standaloneTasks.push(t);
      continue;
    }
    const arr = chainTasks.get(chainKey) ?? [];
    arr.push(t);
    chainTasks.set(chainKey, arr);
  }

  const sortChainGroup = (group: Array<(typeof all)[number]>) =>
    [...group].sort((a, b) => {
      const ma = toTaskMeta(a.meta);
      const mb = toTaskMeta(b.meta);
      const oa = asNumber(ma.chainOrder) ?? 0;
      const ob = asNumber(mb.chainOrder) ?? 0;
      if (oa !== ob) return oa - ob;
      const ta = asNumber(ma.targetValue) ?? 0;
      const tb = asNumber(mb.targetValue) ?? 0;
      return ta - tb;
    });

  const selectedTasks: Array<(typeof all)[number]> = [...standaloneTasks];
  for (const [, group] of chainTasks) {
    const sorted = sortChainGroup(group);
    let chosen = sorted[sorted.length - 1]!;
    for (const stage of sorted) {
      const pk = periodKeyForTask(stage);
      const ut = getUt(stage.id, pk);
      if (ut?.status !== "completed") {
        chosen = stage;
        break;
      }
    }
    selectedTasks.push(chosen);
  }

  const taskTypeById = new Map(all.map((x) => [x.id, x.type]));
  const completedOneTime = new Set<string>();
  for (const r of userTaskRows) {
    if (r.status !== "completed") continue;
    if (taskTypeById.get(r.taskId) === "one-time") completedOneTime.add(r.taskId);
  }

  const platformGateMemo = new Map<string, Promise<boolean>>();
  const gateFor = (t: (typeof all)[number]) => {
    const key = `${t.platform}:${t.validationType}`;
    let p = platformGateMemo.get(key);
    if (!p) {
      p = canCompletePlatformTask(userId, {
        id: t.id,
        platform: t.platform,
        validationType: t.validationType,
        meta: t.meta,
      });
      platformGateMemo.set(key, p);
    }
    return p;
  };

  const evidenceTaskIds = all
    .filter((t) => toTaskMeta(t.meta).requiresEvidence === true)
    .map((t) => t.id);
  const evidenceByTaskStage = new Map<
    string,
    { status: string; adminNote: string | null }
  >();
  if (evidenceTaskIds.length > 0) {
    const evRows = await db
      .select({
        taskId: taskEvidence.taskId,
        stage: taskEvidence.stage,
        status: taskEvidence.status,
        adminNote: taskEvidence.adminNote,
      })
      .from(taskEvidence)
      .where(
        and(
          eq(taskEvidence.userId, userId),
          inArray(taskEvidence.taskId, evidenceTaskIds)
        )
      );
    for (const e of evRows) {
      evidenceByTaskStage.set(`${e.taskId}:${e.stage}`, {
        status: e.status,
        adminNote: e.adminNote ?? null,
      });
    }
  }

  /** Для цепочек с `hard: true`: сколько этапов уже подтверждено админом или закрыто наградой. */
  const hardChainConfirmed = new Map<string, number>();
  for (const [ck, group] of chainTasks) {
    const sorted = sortChainGroup(group);
    if (!sorted.some((s) => toTaskMeta(s.meta).hard === true)) continue;
    let confirmed = 0;
    for (const stage of sorted) {
      const pk = periodKeyForTask(stage);
      const ut = getUt(stage.id, pk);
      const sm = toTaskMeta(stage.meta);
      const evSt = evidenceStageForTask(sm);
      const ev = evidenceByTaskStage.get(`${stage.id}:${evSt}`);
      const claimed =
        ut?.status === "completed" ||
        (stage.type === "one-time" && completedOneTime.has(stage.id));
      const adminOk = ev?.status === "approved";
      if (claimed || adminOk) confirmed++;
    }
    hardChainConfirmed.set(ck, confirmed);
  }

  /** Проверки платформы независимы — раньше шли подряд и суммировали латентность. */
  const platformGateOk = new Map<string, boolean>();
  await Promise.all(
    selectedTasks.map(async (t) => {
      if (t.platform === "global") return;
      platformGateOk.set(t.id, await gateFor(t));
    })
  );

  const rows: TaskDto[] = [];
  for (const t of selectedTasks) {
    const pk = periodKeyForTask(t);
    const ut = getUt(t.id, pk);

    let userStatus: UserTaskStatus = "available";
    if (ut?.status === "completed") userStatus = "completed";
    else if (ut?.status === "pending") userStatus = "pending";
    else if (t.type === "one-time" && completedOneTime.has(t.id)) {
      userStatus = "completed";
    }

    if (t.platform !== "global") {
      const ok = platformGateOk.get(t.id) ?? false;
      if (!ok && userStatus !== "completed" && userStatus !== "pending") {
        userStatus = "locked";
      }
    }

    const meta = toTaskMeta(t.meta);
    const progress = readProgress(meta, progressSnapshot);
    const chainKey = asString(meta.chainKey);
    const hardStageTotal = asNumber(meta.hardStageTotal);
    const hardStageCurrentMeta = asNumber(meta.hardStageCurrent);
    const chainOrder = asNumber(meta.chainOrder);
    const ui = extractTaskUiFields(meta);
    const coverMedia = extractCoverImageMedia(meta);
    const coverImageUrl =
      extractCoverImageUrl(meta) ?? coverMedia?.fallbackSrc ?? null;
    const uiSection = asString(meta.uiSection);
    const uiOrder = asNumber(meta.uiOrder);
    const requiresEvidence = meta.requiresEvidence === true;
    const evidenceExamples = extractEvidenceExamples(meta);
    let evidenceStageStatus: TaskDto["evidenceStageStatus"];
    let evidenceAdminNote: string | null | undefined;
    if (requiresEvidence) {
      const st = evidenceStageForTask(meta);
      const ev = evidenceByTaskStage.get(`${t.id}:${st}`);
      if (!ev) evidenceStageStatus = "none";
      else if (ev.status === "submitted") evidenceStageStatus = "submitted";
      else if (ev.status === "approved") evidenceStageStatus = "approved";
      else if (ev.status === "rejected") evidenceStageStatus = "rejected";
      else evidenceStageStatus = "none";
      if (evidenceStageStatus === "rejected" && ev?.adminNote)
        evidenceAdminNote = ev.adminNote;
    }
    const slimMeta = slimMetaForTaskList(meta);
    rows.push({
      id: t.id,
      title: t.title,
      description: t.description,
      reward: t.reward,
      platform: t.platform as TaskDto["platform"],
      type: t.type as TaskDto["type"],
      validationType: t.validationType as TaskDto["validationType"],
      userStatus,
      periodKey: t.type === "daily" ? pk : null,
      ...(slimMeta ? { meta: slimMeta } : {}),
      lastError: ut?.lastError ?? null,
      actionUrl: ui.actionUrl,
      actionLabel: ui.actionLabel,
      verifyLabel: ui.verifyLabel,
      help: ui.help,
      ...(coverImageUrl ? { coverImageUrl } : {}),
      ...(coverMedia ? { coverImageMedia: coverMedia } : {}),
      progressCurrent: progress?.current,
      progressTarget: progress?.target,
      progressLabel: progress?.label ?? null,
      chainKey,
      ...(chainOrder != null ? { chainOrder: Math.floor(chainOrder) } : {}),
      hard: meta.hard === true,
      hardStageCurrent:
        chainKey &&
        hardStageTotal != null &&
        hardStageTotal > 0 &&
        hardChainConfirmed.has(chainKey)
          ? Math.min(
              Math.floor(hardStageTotal),
              hardChainConfirmed.get(chainKey)!
            )
          : hardStageCurrentMeta != null
            ? Math.floor(hardStageCurrentMeta)
            : undefined,
      hardStageTotal: hardStageTotal != null ? Math.floor(hardStageTotal) : undefined,
      uiSection: uiSection ?? null,
      uiOrder: uiOrder != null ? Math.floor(uiOrder) : undefined,
      ...(requiresEvidence ? { requiresEvidence: true } : {}),
      ...(evidenceExamples?.length ? { evidenceExamples } : {}),
      ...(requiresEvidence
        ? { evidenceStageStatus, evidenceAdminNote: evidenceAdminNote ?? null }
        : {}),
    });
  }
  rows.sort((a, b) => {
    const ra = SECTION_UI_RANK[a.uiSection ?? ""] ?? 50;
    const rb = SECTION_UI_RANK[b.uiSection ?? ""] ?? 50;
    if (ra !== rb) return ra - rb;
    const oa = a.uiOrder ?? 999;
    const ob = b.uiOrder ?? 999;
    return oa - ob;
  });
  void setCachedUserTaskDtoList(userId, rows);
  return rows;
}

export async function listTasksForUser(userId: string): Promise<TaskDto[]> {
  const all = await getActiveTasksCached();
  await runRevocationChecksBatched(userId, all);
  const cachedList = await getCachedUserTaskDtoList(userId);
  if (cachedList) return cachedList;
  return singleFlight(`tasks:userdto:${userId}`, () =>
    computeUserTaskDtoList(userId, all)
  );
}

export async function claimTask(
  userId: string,
  taskId: string
): Promise<
  | { ok: true; mode: "sync"; reward: number }
  | { ok: true; mode: "async"; jobId: string }
  | { ok: false; error: string }
> {
  const [t] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.active, true)))
    .limit(1);
  if (!t) return { ok: false, error: "task_not_found" };

  const pk = periodKeyForTask(t);

  if (t.type === "one-time") {
    const [done] = await db
      .select()
      .from(userTasks)
      .where(
        and(
          eq(userTasks.userId, userId),
          eq(userTasks.taskId, taskId),
          eq(userTasks.status, "completed")
        )
      )
      .limit(1);
    if (done) return { ok: false, error: "already_completed" };
  }

  const [existing] = await db
    .select()
    .from(userTasks)
    .where(
      and(
        eq(userTasks.userId, userId),
        eq(userTasks.taskId, taskId),
        eq(userTasks.periodKey, pk)
      )
    )
    .limit(1);
  if (existing?.status === "completed")
    return { ok: false, error: "already_completed" };

  const platformOk = await canCompletePlatformTask(userId, {
    id: t.id,
    platform: t.platform,
    validationType: t.validationType,
    meta: t.meta,
  });
  if (!platformOk) return { ok: false, error: "platform_required" };

  const progress = readProgress(toTaskMeta(t.meta), await buildProgressSnapshot(userId));
  if (progress && progress.current < progress.target) {
    return { ok: false, error: "progress_not_reached" };
  }

  const meta = toTaskMeta(t.meta);
  if (meta.requiresEvidence === true) {
    const stage = evidenceStageForTask(meta);
    const [ev] = await db
      .select()
      .from(taskEvidence)
      .where(
        and(
          eq(taskEvidence.userId, userId),
          eq(taskEvidence.taskId, taskId),
          eq(taskEvidence.stage, stage)
        )
      )
      .limit(1);
    if (!ev) return { ok: false, error: "evidence_required" };
    if (ev.status !== "approved") return { ok: false, error: "evidence_pending" };
  }

  if (t.validationType === "api") {
    const jobId = `v:${userId}:${taskId}:${pk}`;
    if (existing?.status === "pending") {
      invalidateUserTaskDtoCache(userId);
      return { ok: true, mode: "async", jobId };
    }

    if (existing) {
      await db
        .update(userTasks)
        .set({
          status: "pending",
          lastError: null,
          updatedAt: sql`now()`,
        })
        .where(eq(userTasks.id, existing.id));
    } else {
      await db.insert(userTasks).values({
        userId,
        taskId,
        status: "pending",
        periodKey: pk,
      });
    }
    invalidateUserTaskDtoCache(userId);

    try {
      const q = getTaskVerifyQueue();
      await q.add(
        "verify",
        { userId, taskId, periodKey: pk },
        {
          jobId,
          removeOnComplete: true,
          attempts: 3,
          backoff: { type: "exponential", delay: 5000 },
        }
      );
    } catch (queueErr: unknown) {
      const msg =
        queueErr instanceof Error ? queueErr.message : String(queueErr);
      console.error(
        "[claimTask] task-verify queue add failed, inline verify:",
        msg
      );
      try {
        await processVerifyTaskJob({ userId, taskId, periodKey: pk });
      } catch (inlineErr: unknown) {
        const im =
          inlineErr instanceof Error ? inlineErr.message : String(inlineErr);
        console.error("[claimTask] inline verify threw:", im);
        await db
          .update(userTasks)
          .set({
            status: "available",
            lastError: "queue_unavailable",
            updatedAt: sql`now()`,
          })
          .where(
            and(
              eq(userTasks.userId, userId),
              eq(userTasks.taskId, taskId),
              eq(userTasks.periodKey, pk)
            )
          );
        return { ok: false, error: "queue_unavailable" };
      }

      const [after] = await db
        .select()
        .from(userTasks)
        .where(
          and(
            eq(userTasks.userId, userId),
            eq(userTasks.taskId, taskId),
            eq(userTasks.periodKey, pk)
          )
        )
        .limit(1);

      if (after?.status === "completed") {
        invalidateUserTaskDtoCache(userId);
        return {
          ok: true,
          mode: "sync",
          reward: Math.max(0, Math.floor(Number(after.rewardGranted ?? 0))),
        };
      }

      const reason = after?.lastError?.trim();
      if (reason) {
        return { ok: false, error: reason };
      }
      return { ok: false, error: "verify_failed" };
    }

    invalidateUserTaskDtoCache(userId);
    return { ok: true, mode: "async", jobId };
  }

  const [b] = await db
    .select({ lifetimeEarned: userBalances.lifetimeEarned })
    .from(userBalances)
    .where(eq(userBalances.userId, userId))
    .limit(1);

  const level = computeLevel(b?.lifetimeEarned ?? 0);
  const mult = computeRewardMultiplier(level);
  const reward = Math.floor(t.reward * mult);

  const idem = `task:${userId}:${taskId}:${pk}`;
  const credit =
    t.platform === "twitch"
      ? await applyCredit({
          userId,
          amount: reward,
          idempotencyKey: idem,
          kind: "task_reward",
          platform: "twitch",
          referenceType: "task",
          referenceId: taskId,
          meta: { baseReward: t.reward, level, mult },
        })
      : t.platform === "kick"
        ? await applyCredit({
            userId,
            amount: reward,
            idempotencyKey: idem,
            kind: "task_reward",
            platform: "kick",
            referenceType: "task",
            referenceId: taskId,
            meta: { baseReward: t.reward, level, mult },
          })
        : await applyCreditSplit({
            userId,
            amount: reward,
            idempotencyKey: idem,
            kind: "task_reward",
            referenceType: "task",
            referenceId: taskId,
            meta: { baseReward: t.reward, level, mult },
          });

  if (!credit.ok) return { ok: false, error: "already_completed" };

  const refundPlatform: "twitch" | "kick" | "global" =
    t.platform === "twitch"
      ? "twitch"
      : t.platform === "kick"
        ? "kick"
        : "global";

  try {
    if (existing) {
      await db
        .update(userTasks)
        .set({
          status: "completed",
          lastError: null,
          rewardGranted: credit.creditedAmount,
          rewardPlatform: rewardPlatformLabel(t.platform),
          updatedAt: sql`now()`,
        })
        .where(eq(userTasks.id, existing.id));
    } else {
      await db.insert(userTasks).values({
        userId,
        taskId,
        status: "completed",
        periodKey: pk,
        rewardGranted: credit.creditedAmount,
        rewardPlatform: rewardPlatformLabel(t.platform),
      });
    }
  } catch {
    await reverseTaskRewardCredit({
      userId,
      taskId,
      periodKey: pk,
      platform: refundPlatform,
      amount: credit.creditedAmount,
    });
    throw new Error("task_persist_failed");
  }

  await maybeQualifyReferral(userId);

  invalidateUserTaskDtoCache(userId);
  return {
    ok: true,
    mode: "sync",
    reward: credit.creditedAmount,
  };
}
