import { memo, useCallback } from "react";
import { ChevronRight, Coins, HelpCircle } from "lucide-react";
import type { Platform, TaskDto } from "shared";
import { ResponsivePicture } from "../ResponsivePicture";

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

function streamPreviewThemeClass(
  section: string,
  activePlatform: Platform
): string {
  if (section !== "stream_tasks" && section !== "live_stream_tasks") return "";
  return activePlatform === "kick"
    ? "task-card-preview--kick-stream"
    : "task-card-preview--twitch-stream";
}

function taskKindPill(t: TaskDto): {
  label: string;
  variant: "sub" | "project" | "neutral";
} {
  if (t.requiresEvidence) return { label: "Проект", variant: "project" };
  if (t.validationType === "api") return { label: "Подписка", variant: "sub" };
  return { label: "Задание", variant: "neutral" };
}

function showHelpOnTaskCard(t: TaskDto): boolean {
  if (!t.help) return false;
  if (
    t.validationType === "api" &&
    (t.platform === "twitch" || t.platform === "kick")
  ) {
    return false;
  }
  return true;
}

export type TaskCardPreviewProps = {
  t: TaskDto;
  section: string;
  activePlatform: Platform;
  onOpenDetail: (task: TaskDto) => void;
  onOpenHelp: (task: TaskDto) => void;
};

function TaskCardPreviewInner({
  t,
  section,
  activePlatform,
  onOpenDetail,
  onOpenHelp,
}: TaskCardPreviewProps) {
  const done = t.userStatus === "completed";
  const streamTheme = streamPreviewThemeClass(section, activePlatform);
  const kind = taskKindPill(t);
  const cardHelp = showHelpOnTaskCard(t);
  const kindClass =
    kind.variant === "sub"
      ? "pill pill--task-sub"
      : kind.variant === "project"
        ? "pill pill--task-project"
        : "pill";

  const openDetail = useCallback(() => onOpenDetail(t), [onOpenDetail, t]);
  const openHelp = useCallback(() => onOpenHelp(t), [onOpenHelp, t]);

  return (
    <article
      className={`task-card-preview fade-in-soft ${streamTheme} ${t.validationType === "api" ? "task-card-preview--accent" : ""} ${done ? "task-card-preview--done" : ""}${t.coverImageUrl || t.coverImageMedia ? " task-card-preview--has-cover" : ""}`}
    >
      {t.coverImageMedia ? (
        <ResponsivePicture
          image={t.coverImageMedia}
          alt=""
          sizes="(max-width: 640px) 100vw, 420px"
          layout="fill"
          className="task-card-preview__cover"
        />
      ) : t.coverImageUrl ? (
        <div
          className="task-card-preview__cover"
          style={{
            backgroundImage: `url(${JSON.stringify(t.coverImageUrl)})`,
          }}
          aria-hidden
        />
      ) : null}
      <button
        type="button"
        className={`task-card-preview__main ${cardHelp ? "task-card-preview__main--with-help" : ""}`}
        onClick={openDetail}
      >
        <div className="task-card-preview__row">
          <div className="task-card-preview__tags">
            <span className={kindClass}>{kind.label}</span>
            <span className={platformPillClass(t.platform)}>
              {platformLabel(t.platform)}
            </span>
            <span className="pill pill--compact">
              {t.type === "daily" ? "Ежедневно" : "Разово"}
            </span>
            {t.validationType === "api" ? (
              <span className="pill pill--accent pill--compact">С проверкой</span>
            ) : null}
            {done ? (
              <span className="pill pill--accent pill--compact">Готово</span>
            ) : null}
            {!done &&
            t.requiresEvidence &&
            t.evidenceStageStatus === "submitted" ? (
              <span className="pill pill--task-pending pill--compact">
                На рассмотрении
              </span>
            ) : null}
            {!done &&
            t.validationType === "api" &&
            t.userStatus === "pending" ? (
              <span className="pill pill--task-pending pill--compact">
                Проверка…
              </span>
            ) : null}
          </div>
          <div className="task-card-preview__reward">
            <Coins size={18} strokeWidth={2.2} aria-hidden />
            <span>{t.reward.toLocaleString("ru-RU")}</span>
          </div>
        </div>
        <h3 className="task-card-preview__title">{t.title}</h3>
        <p className="task-card-preview__snippet">{t.description}</p>
        <div className="task-card-preview__footer">
          <span className="task-card-preview__hint muted">
            Подробности и действия
          </span>
          <ChevronRight
            className="task-card-preview__arrow"
            size={20}
            strokeWidth={2}
            aria-hidden
          />
        </div>
      </button>
      {cardHelp ? (
        <button
          type="button"
          className="task-card-preview__help"
          aria-label="Справка по заданию"
          onClick={openHelp}
        >
          <HelpCircle size={18} strokeWidth={2.2} />
        </button>
      ) : null}
    </article>
  );
}

export const TaskCardPreview = memo(TaskCardPreviewInner);
