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
  evidenceUploading,
  onUploadEvidence,
}: {
  task: TaskDto | null;
  open: boolean;
  onClose: () => void;
  onClaim: () => void;
  claiming: boolean;
  statusMessage: string | null;
  evidenceUploading?: boolean;
  onUploadEvidence?: (images: string[]) => Promise<void>;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [openedLink, setOpenedLink] = useState(false);
  const [files, setFiles] = useState<FileList | null>(null);

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

  async function uploadEvidence() {
    if (!onUploadEvidence || !files || files.length === 0) return;
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
    if (encoded.length > 0) {
      await onUploadEvidence(encoded);
      setFiles(null);
    }
  }

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

        {task.hard ? (
          <div className="stack">
            <p className="muted m-0">
              HARD {Math.max(0, task.hardStageCurrent ?? 0)}/{Math.max(0, task.hardStageTotal ?? 2)}
            </p>
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => setFiles(e.target.files)}
            />
            <button
              type="button"
              className="task-detail-btn task-detail-btn--secondary"
              disabled={!onUploadEvidence || evidenceUploading || !files || files.length === 0}
              onClick={() => void uploadEvidence()}
            >
              {evidenceUploading ? "Загрузка…" : "Загрузить скрины"}
            </button>
          </div>
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
