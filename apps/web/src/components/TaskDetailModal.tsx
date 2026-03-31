import { Coins, Info, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import WebApp from "@twa-dev/sdk";
import type { Platform, TaskDto } from "shared";
import { HelpSheetModal } from "./HelpSheetModal";

function defaultActionLabel(platform: Platform): string {
  if (platform === "kick") return "Подписаться на Kick";
  if (platform === "twitch") return "Подписаться на Twitch";
  if (platform === "telegram") return "Подписаться в Telegram";
  return "Перейти";
}

function primaryCtaLabel(task: TaskDto, claiming: boolean): string {
  if (claiming) return task.validationType === "api" ? "Проверка…" : "Зачисление…";
  if (task.userStatus === "completed") return "Готово";
  if (task.userStatus === "locked") return "Нужна привязка платформы";
  if (task.userStatus === "pending") return "Проверяется…";
  if (task.validationType === "api") {
    return task.verifyLabel?.trim() || "Проверить подписку";
  }
  return "Забрать награду";
}

export function TaskDetailModal({
  task,
  open,
  onClose,
  onClaim,
  claiming,
  statusMessage,
}: {
  task: TaskDto | null;
  open: boolean;
  onClose: () => void;
  onClaim: () => void;
  claiming: boolean;
  statusMessage: string | null;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [openedLink, setOpenedLink] = useState(false);

  useEffect(() => {
    setOpenedLink(false);
    setHelpOpen(false);
  }, [task?.id, open]);

  if (!open || !task) return null;

  const actionUrl = task.actionUrl?.trim() || null;
  const actionLabel = task.actionLabel?.trim() || defaultActionLabel(task.platform);

  function openAction() {
    if (!actionUrl) return;
    try {
      WebApp.openLink(actionUrl);
    } catch {
      window.open(actionUrl, "_blank", "noopener,noreferrer");
    }
    setOpenedLink(true);
  }

  const canClaim = task.userStatus === "available" && !claiming;
  const showLinkHint =
    Boolean(actionUrl) && canClaim && !openedLink && task.userStatus === "available";
  const pulseVerify = Boolean(actionUrl) && openedLink && canClaim;

  const content = (
    <div
      className="task-detail-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="task-detail-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="task-detail-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="task-detail-modal__head">
          <h2 id="task-detail-title" className="task-detail-modal__title">
            {task.title}
          </h2>
          <div className="task-detail-modal__head-actions">
            {task.help ? (
              <button
                type="button"
                className="task-detail-modal__help-btn"
                aria-label="Справка"
                onClick={() => setHelpOpen(true)}
              >
                <Info size={20} strokeWidth={2.2} />
              </button>
            ) : null}
            <button
              type="button"
              className="task-detail-modal__close"
              aria-label="Закрыть"
              onClick={onClose}
            >
              <X size={20} strokeWidth={2.2} />
            </button>
          </div>
        </div>

        <p className="task-detail-modal__desc">{task.description}</p>

        <div className="task-detail-reward">
          <span className="task-detail-reward__label">Награда:</span>
          <span className="task-detail-reward__value">
            <Coins size={22} strokeWidth={2.2} className="task-detail-reward__coin" aria-hidden />
            {task.reward.toLocaleString("ru-RU")}
          </span>
        </div>

        {statusMessage ? (
          <p className="task-detail-modal__msg muted">{statusMessage}</p>
        ) : null}

        <div className="task-detail-modal__actions">
          {actionUrl ? (
            <button
              type="button"
              className="task-detail-btn task-detail-btn--secondary"
              onClick={openAction}
            >
              {actionLabel}
            </button>
          ) : null}

          <button
            type="button"
            className={`task-detail-btn task-detail-btn--primary ${pulseVerify ? "task-detail-btn--primary--glow" : ""} ${showLinkHint ? "task-detail-btn--primary--soft" : ""}`}
            disabled={!canClaim}
            onClick={onClaim}
          >
            {primaryCtaLabel(task, claiming)}
          </button>
        </div>

        {showLinkHint ? (
          <p className="task-detail-link-hint muted">
            Сначала открой ссылку выше, затем нажми «{primaryCtaLabel(task, false)}».
          </p>
        ) : null}
      </div>

      {task.help ? (
        <HelpSheetModal
          open={helpOpen}
          title={task.help.title}
          body={task.help.body}
          icon={task.help.icon}
          onClose={() => setHelpOpen(false)}
        />
      ) : null}
    </div>
  );

  return createPortal(content, document.body);
}
