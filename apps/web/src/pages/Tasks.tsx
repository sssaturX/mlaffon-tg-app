import { useCallback, useEffect, useMemo, useState } from "react";
import { Coins, HelpCircle, Lightbulb } from "lucide-react";
import type { Platform, TaskDto, TaskEvidenceExamples } from "shared";
import WebApp from "@twa-dev/sdk";
import { api, formatApiError } from "../api";
import { useMeEconomySync } from "../context/MeEconomySyncContext";
import { useActivePlatform } from "../context/PlatformContext";
import { HelpSheetModal } from "../components/HelpSheetModal";
import { useInvalidateTasks, useTasks } from "../hooks/queries/useTasks";
import { ApiQueryError } from "../query/apiQueryError";
import { appEventBus } from "../events/appEventBus";

const SECTION_ORDER = [
  "black_russia",
  "stream_tasks",
  "telegram",
  "global",
  "other",
] as const;

function platformPillClass(p: Platform): string {
  if (p === "twitch") return "pill pill--twitch";
  if (p === "kick") return "pill pill--kick";
  if (p === "telegram") return "pill pill--telegram";
  return "pill pill--global";
}

function platformLabel(p: Platform): string {
  if (p === "global") return "Global";
  if (p === "telegram") return "Telegram";
  return p[0]!.toUpperCase() + p.slice(1);
}

function sectionHeading(section: string, activePlatform: Platform): string {
  if (section === "black_russia") return "BLACK RUSSIA";
  if (section === "stream_tasks")
    return activePlatform === "kick" ? "KICK" : "TWITCH";
  if (section === "telegram") return "TELEGRAM";
  if (section === "global") return "ОБЩЕЕ";
  return "ЗАДАНИЯ";
}

function defaultActionLabel(platform: Platform): string {
  if (platform === "kick") return "Подписаться на Kick";
  if (platform === "twitch") return "Подписаться на Twitch";
  if (platform === "telegram") return "Подписаться в Telegram";
  return "Перейти";
}

function openExternalUrl(url: string) {
  try {
    WebApp.openLink(url);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

function TaskListSkeleton() {
  return (
    <div className="task-list-skeleton" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="task-card task-card--stream task-card--skeleton">
          <div className="skeleton task-skeleton__line task-skeleton__line--short" />
          <div className="skeleton task-skeleton__line" />
          <div className="skeleton task-skeleton__line" />
        </div>
      ))}
    </div>
  );
}

function evidenceExampleImageSrc(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const base = import.meta.env.BASE_URL || "/";
  const path = url.startsWith("/") ? url.slice(1) : url;
  return base.endsWith("/") ? `${base}${path}` : `${base}/${path}`;
}

function TaskEvidenceExamplesBlock({ ex }: { ex: TaskEvidenceExamples }) {
  if (!ex.items.length) return null;
  return (
    <details className="task-card__evidence-examples">
      <summary className="task-card__evidence-examples-summary">{ex.title}</summary>
      <div className="task-card__evidence-examples-grid">
        {ex.items.map((it, i) => (
          <figure key={i} className="task-card__evidence-example">
            <img
              src={evidenceExampleImageSrc(it.imageUrl)}
              alt={it.label ?? `Пример ${i + 1}`}
              className="task-card__evidence-example-img"
              loading="lazy"
            />
            {it.label ? (
              <figcaption className="task-card__evidence-example-cap muted">
                {it.label}
              </figcaption>
            ) : null}
          </figure>
        ))}
      </div>
    </details>
  );
}

function hardStageDisplay(t: TaskDto): { cur: number; total: number } | null {
  if (!t.hard || typeof t.hardStageTotal !== "number" || t.hardStageTotal <= 0) {
    return null;
  }
  const raw = t.hardStageCurrent ?? 0;
  const cur = Math.min(t.hardStageTotal, Math.max(1, raw + 1));
  return { cur, total: t.hardStageTotal };
}

export default function Tasks() {
  const { patchMe, syncMeFromNetwork, reconcileFromServer } =
    useMeEconomySync();
  const { activePlatform } = useActivePlatform();
  const invalidateTasks = useInvalidateTasks(activePlatform);
  const tasksQ = useTasks(activePlatform);
  const tasks = tasksQ.data ?? [];
  const [msg, setMsg] = useState<string | null>(null);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [evidenceByTask, setEvidenceByTask] = useState<Record<string, FileList | null>>({});
  const [evidenceUploadingId, setEvidenceUploadingId] = useState<string | null>(null);
  const [helpTask, setHelpTask] = useState<TaskDto | null>(null);

  const loading = tasksQ.isPending;

  useEffect(() => {
    if (tasksQ.isError) {
      const e = tasksQ.error;
      setMsg(
        e instanceof ApiQueryError ? formatApiError(e.apiErr) : "Ошибка загрузки"
      );
    } else if (tasksQ.isSuccess) setMsg(null);
  }, [tasksQ.isError, tasksQ.isSuccess, tasksQ.error]);

  const grouped = useMemo(() => {
    const map = new Map<string, TaskDto[]>();
    for (const t of tasks) {
      const key = t.uiSection?.trim() || "other";
      const arr = map.get(key) ?? [];
      arr.push(t);
      map.set(key, arr);
    }
    return map;
  }, [tasks]);

  const sectionKeys = useMemo(() => {
    const order = [...SECTION_ORDER] as string[];
    const keys: string[] = [];
    for (const k of SECTION_ORDER) {
      if (grouped.get(k)?.length) keys.push(k);
    }
    for (const k of grouped.keys()) {
      if (!order.includes(k) && grouped.get(k)?.length) keys.push(k);
    }
    return keys;
  }, [grouped]);

  async function claim(id: string) {
    setMsg(null);
    setClaimingId(id);
    const r = await api<{
      reward?: number;
      coins?: number;
      coinsTwitch?: number;
      coinsKick?: number;
      status?: string;
      jobId?: string;
    }>(`/api/v1/tasks/${id}/claim`, { method: "POST" });
    setClaimingId(null);
    if (r.ok) {
      if (r.data.status === "pending") {
        const m =
          "Задание в очереди на проверку. Обновите через несколько секунд.";
        setMsg(m);
        invalidateTasks();
        appEventBus.emit("me:reconcile:economy", { delayMs: 0 });
        return;
      }
      const okMsg = `+${r.data.reward ?? 0} монет`;
      setMsg(okMsg);
      invalidateTasks();
      if (
        typeof r.data.coins === "number" &&
        typeof r.data.coinsTwitch === "number" &&
        typeof r.data.coinsKick === "number"
      ) {
        patchMe(() => ({
          coins: r.data.coins,
          coinsTwitch: r.data.coinsTwitch,
          coinsKick: r.data.coinsKick,
        }));
        reconcileFromServer();
      } else {
        void syncMeFromNetwork();
      }
    } else {
      setMsg(formatApiError(r));
    }
  }

  const uploadEvidence = useCallback(
    async (task: TaskDto, images: string[]) => {
      setEvidenceUploadingId(task.id);
      const stage = Math.max(1, (task.hardStageCurrent ?? 0) + 1);
      const r = await api<{ ok: boolean }>(`/api/v1/tasks/${task.id}/evidence`, {
        method: "POST",
        body: JSON.stringify({ stage, images }),
      });
      setEvidenceUploadingId(null);
      if (r.ok) {
        setMsg("Скрины загружены. Дождитесь проверки админом.");
        setEvidenceByTask((prev) => ({ ...prev, [task.id]: null }));
        invalidateTasks();
        return;
      }
      setMsg(formatApiError(r));
    },
    [invalidateTasks]
  );

  async function submitEvidence(task: TaskDto) {
    const files = evidenceByTask[task.id];
    if (!files || files.length === 0) return;
    const list = Array.from(files).slice(0, 4);
    const encoded: string[] = [];
    for (const f of list) {
      if (!/^image\//i.test(f.type)) continue;
      if (f.size > 2_500_000) continue;
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("read_failed"));
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.readAsDataURL(f);
      });
      encoded.push(data);
    }
    if (encoded.length > 0) await uploadEvidence(task, encoded);
  }

  function actionLabelForTask(t: TaskDto): string {
    if (t.userStatus === "completed") return "Выполнено";
    if (t.userStatus === "pending") return "Проверяем…";
    if (t.userStatus === "locked") return "Недоступно";
    if (
      typeof t.progressTarget === "number" &&
      typeof t.progressCurrent === "number" &&
      t.progressCurrent >= t.progressTarget
    ) {
      return "Получить";
    }
    return t.verifyLabel ?? "Проверить";
  }

  function actionDisabled(t: TaskDto): boolean {
    return (
      t.userStatus === "completed" ||
      t.userStatus === "pending" ||
      t.userStatus === "locked"
    );
  }

  function renderTaskCard(t: TaskDto) {
    const done = t.userStatus === "completed";
    const actionUrl = t.actionUrl?.trim() || null;
    const actionLabel =
      t.actionLabel?.trim() || defaultActionLabel(t.platform);
    const hardDisp = hardStageDisplay(t);
    const claiming = claimingId === t.id;
    const evUp = evidenceUploadingId === t.id;

    return (
      <article
        key={t.id}
        className={`task-card task-card--stream fade-in-soft ${t.validationType === "api" ? "task-card--border" : ""} ${done ? "task-card--done" : ""}`}
      >
        <div className="task-card__top">
          <div className="task-card__tags">
            <span className={platformPillClass(t.platform)}>
              {platformLabel(t.platform)}
            </span>
            <span className="pill">
              {t.type === "daily" ? "Ежедневно" : "Разово"}
            </span>
            {t.validationType === "api" ? (
              <span className="pill pill--accent">С проверкой</span>
            ) : null}
            {done ? <span className="pill pill--accent">Выполнено</span> : null}
            {t.help ? (
              <button
                type="button"
                className="task-card__help-icon"
                aria-label="Справка"
                onClick={() => setHelpTask(t)}
              >
                <HelpCircle size={16} strokeWidth={2.2} />
              </button>
            ) : null}
          </div>
          <div className="task-card__reward">
            <Coins size={18} strokeWidth={2.2} aria-hidden />
            {t.reward.toLocaleString("ru-RU")}
          </div>
        </div>

        <h3 className="task-card__title task-card__title--stream">{t.title}</h3>
        <div className="task-card__desc task-card__desc--stream">
          {t.description.split("\n").map((line, i) => (
            <p key={i} className="task-card__desc-line">
              {line}
            </p>
          ))}
        </div>

        {hardDisp ? (
          <div className="task-progress task-progress--stream">
            <div className="task-progress__head">
              <span className="muted">Этап</span>
              <span className="muted">
                {hardDisp.cur}/{hardDisp.total}
              </span>
            </div>
            <div className="task-progress__bar">
              <div
                className="task-progress__fill"
                style={{
                  width: `${Math.max(
                    0,
                    Math.min(100, (hardDisp.cur / Math.max(1, hardDisp.total)) * 100)
                  )}%`,
                }}
              />
            </div>
          </div>
        ) : null}

        {typeof t.progressCurrent === "number" &&
        typeof t.progressTarget === "number" ? (
          <div className="task-progress task-progress--stream">
            <div className="task-progress__head">
              <span className="muted">{t.progressLabel ?? "Прогресс"}</span>
              <span className="muted">
                {t.progressCurrent}/{t.progressTarget}
              </span>
            </div>
            <div className="task-progress__bar">
              <div
                className="task-progress__fill"
                style={{
                  width: `${Math.max(
                    0,
                    Math.min(
                      100,
                      (t.progressCurrent / Math.max(1, t.progressTarget)) * 100
                    )
                  )}%`,
                }}
              />
            </div>
          </div>
        ) : null}

        {t.hard ? (
          <div className="task-card__evidence">
            {t.evidenceExamples ? (
              <TaskEvidenceExamplesBlock ex={t.evidenceExamples} />
            ) : null}
            {!done ? (
              <p className="task-card__evidence-flow-hint muted">
                Загрузи свои скрины по образцу. После одобрения админа нажми «
                {t.verifyLabel?.trim() || actionLabelForTask(t)}», чтобы получить
                монеты
                {t.chainKey === "br_hard" && t.hardStageCurrent === 0
                  ? " и открыть второй этап"
                  : t.chainKey === "br_hard" && (t.hardStageCurrent ?? 0) >= 1
                    ? " и завершить цепочку"
                    : ""}
                .
              </p>
            ) : null}
            <label className="task-card__file-label muted">
              Скриншоты (до 4, до 2,5 МБ)
            </label>
            <input
              type="file"
              accept="image/*"
              multiple
              className="task-card__file"
              disabled={done}
              onChange={(e) =>
                setEvidenceByTask((prev) => ({
                  ...prev,
                  [t.id]: e.target.files,
                }))
              }
            />
            <button
              type="button"
              className="secondary task-card__btn-row"
              disabled={
                done ||
                evUp ||
                !evidenceByTask[t.id] ||
                evidenceByTask[t.id]!.length === 0
              }
              onClick={() => void submitEvidence(t)}
            >
              {evUp ? "Загрузка…" : "Загрузить скрины"}
            </button>
          </div>
        ) : null}

        {t.lastError ? <p className="err task-card__err">{t.lastError}</p> : null}

        <div className="task-card__actions-row">
          {actionUrl && !done ? (
            <button
              type="button"
              className="secondary task-card__btn-half"
              onClick={() => openExternalUrl(actionUrl)}
            >
              {actionLabel}
            </button>
          ) : null}
          <button
            type="button"
            className={`primary task-card__btn-half ${!actionUrl || done ? "task-card__btn-full" : ""}`}
            disabled={claiming || actionDisabled(t)}
            onClick={() => void claim(t.id)}
          >
            {claiming ? "…" : actionLabelForTask(t)}
          </button>
        </div>
      </article>
    );
  }

  return (
    <div>
      <div className="task-hint task-hint--stream" role="note">
        <Lightbulb size={20} className="task-hint__icon" aria-hidden />
        <span>
          Задания в стиле стрима: всё на карточке, без отдельного окна «подробнее».
          Больше заданий появляется, когда идёт стрим.
        </span>
      </div>

      {msg ? <p className="muted fade-in-soft task-page-msg">{msg}</p> : null}

      {loading ? (
        <TaskListSkeleton />
      ) : tasks.length === 0 ? (
        <div className="card text-center fade-in-soft">
          <p className="empty-state__title mb-2">Нет заданий</p>
          <p className="muted m-0">
            Для платформы в шапке сейчас нет доступных заданий.
          </p>
        </div>
      ) : (
        <div className="task-stream">
          {sectionKeys.map((section) => (
            <section key={section} className="task-stream__section">
              <h2 className="task-stream__heading">
                {sectionHeading(section, activePlatform)}
              </h2>
              <div className="stack task-stack">
                {(grouped.get(section) ?? []).map((t) => renderTaskCard(t))}
              </div>
            </section>
          ))}
        </div>
      )}

      {helpTask?.help ? (
        <HelpSheetModal
          open={helpTask != null}
          title={helpTask.help.title}
          body={helpTask.help.body}
          icon={helpTask.help.icon}
          onClose={() => setHelpTask(null)}
        />
      ) : null}
    </div>
  );
}
