import { Coins, ImagePlus, Info, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import WebApp from "@twa-dev/sdk";
import type { Platform, TaskDto } from "shared";
import { HelpSheetModal } from "./HelpSheetModal";
import { TaskEvidenceExamples } from "./TaskEvidenceExamples";

/** Справка не показываем для API-подписок Twitch/Kick — только мешает в шапке. */
function showTaskHelpInUi(task: TaskDto): boolean {
  if (!task.help) return false;
  if (
    task.validationType === "api" &&
    (task.platform === "twitch" || task.platform === "kick")
  ) {
    return false;
  }
  return true;
}

function defaultActionLabel(platform: Platform): string {
  if (platform === "kick") return "Подписаться на Kick";
  if (platform === "twitch") return "Подписаться на Twitch";
  if (platform === "telegram") return "Подписаться в Telegram";
  return "Перейти";
}

function TaskEvidenceControls({
  inputId,
  evidenceFiles,
  onEvidenceFilesChange,
  onSubmitEvidence,
  evidenceUploading,
  resubmit,
}: {
  inputId: string;
  evidenceFiles: FileList | null;
  onEvidenceFilesChange: (files: FileList | null) => void;
  onSubmitEvidence: () => Promise<void>;
  evidenceUploading: boolean;
  resubmit: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const count = evidenceFiles?.length ?? 0;
  const hasFiles = count > 0;

  return (
    <div className="task-evidence-controls task-detail-modal__block">
      <input
        ref={inputRef}
        id={inputId}
        type="file"
        accept="image/*,.heic,.heif"
        multiple
        className="task-evidence-controls__input"
        tabIndex={-1}
        onChange={(e) => onEvidenceFilesChange(e.target.files)}
      />
      <button
        type="button"
        className="task-evidence-controls__pick"
        aria-label="Выбрать скриншоты с устройства"
        onClick={() => inputRef.current?.click()}
      >
        <ImagePlus size={22} strokeWidth={2} aria-hidden />
        <span>
          {resubmit ? "Выбрать другие скрины" : "Загрузить скрины"}
        </span>
      </button>
      {hasFiles ? (
        <p className="task-evidence-controls__meta muted m-0">
          Выбрано: {count} из 4 · JPG, PNG, WebP до 2,5 МБ
        </p>
      ) : (
        <p className="task-evidence-controls__hint muted m-0">
          Нажми кнопку выше и выбери скрины в галерее или файлах.
        </p>
      )}
      <button
        type="button"
        className="task-evidence-controls__submit btn primary"
        disabled={evidenceUploading || !hasFiles}
        onClick={() => void onSubmitEvidence()}
      >
        {evidenceUploading
          ? "Отправка…"
          : hasFiles
            ? resubmit
              ? "Отправить новые скрины на проверку"
              : "Отправить скрины на проверку"
            : "Сначала выберите файлы"}
      </button>
    </div>
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

export function TaskDetailModal({
  task,
  open,
  onClose,
  onClaim,
  claiming,
  primaryLabel,
  primaryDisabled,
  statusMessage,
  evidenceFiles,
  onEvidenceFilesChange,
  onSubmitEvidence,
  evidenceUploading,
}: {
  task: TaskDto | null;
  open: boolean;
  onClose: () => void;
  onClaim: () => void;
  claiming: boolean;
  primaryLabel: string;
  primaryDisabled: boolean;
  statusMessage: string | null;
  evidenceFiles: FileList | null;
  onEvidenceFilesChange: (files: FileList | null) => void;
  onSubmitEvidence: () => Promise<void>;
  evidenceUploading: boolean;
}) {
  const [helpOpen, setHelpOpen] = useState(false);
  const [openedLink, setOpenedLink] = useState(false);

  useEffect(() => {
    setOpenedLink(false);
    setHelpOpen(false);
  }, [task?.id, open]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !task) return null;

  const actionUrl = task.actionUrl?.trim() || null;
  const actionLabel = task.actionLabel?.trim() || defaultActionLabel(task.platform);
  const done = task.userStatus === "completed";
  const hardDisp = hardStageDisplay(task);

  function openAction() {
    if (!actionUrl) return;
    try {
      WebApp.openLink(actionUrl);
    } catch {
      window.open(actionUrl, "_blank", "noopener,noreferrer");
    }
    setOpenedLink(true);
  }

  const canInteractPrimary = !claiming && !primaryDisabled;
  const showLinkHint =
    Boolean(actionUrl) && task.userStatus === "available" && canInteractPrimary && !openedLink;
  const pulseVerify =
    Boolean(actionUrl) && openedLink && task.userStatus === "available" && canInteractPrimary;

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
      <div className="task-detail-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="task-detail-sheet__handle" aria-hidden />
        <div className="task-detail-modal task-detail-modal--sheet">
          <div className="task-detail-modal__head">
            <h2 id="task-detail-title" className="task-detail-modal__title">
              {task.title}
            </h2>
            <div className="task-detail-modal__head-actions">
              {showTaskHelpInUi(task) ? (
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

          <div className="task-detail-modal__body">
            <div className="task-detail-modal__desc">
              {task.description.split("\n").map((line, i) => (
                <p key={i} className="task-detail-modal__desc-line">
                  {line}
                </p>
              ))}
            </div>

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

            {hardDisp ? (
              <div className="task-progress task-progress--stream task-detail-modal__block">
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

            {typeof task.progressCurrent === "number" &&
            typeof task.progressTarget === "number" ? (
              <div className="task-progress task-progress--stream task-detail-modal__block">
                <div className="task-progress__head">
                  <span className="muted">{task.progressLabel ?? "Прогресс"}</span>
                  <span className="muted">
                    {task.progressCurrent}/{task.progressTarget}
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
                          (task.progressCurrent / Math.max(1, task.progressTarget)) * 100
                        )
                      )}%`,
                    }}
                  />
                </div>
              </div>
            ) : null}

            {task.requiresEvidence && task.evidenceExamples?.length ? (
              <div className="task-detail-modal__block">
                <TaskEvidenceExamples examples={task.evidenceExamples} />
              </div>
            ) : null}

            {task.requiresEvidence && !done ? (
              <p className="task-card__evidence-status muted task-detail-modal__block">
                {(task.evidenceStageStatus ?? "none") === "none"
                  ? "Загрузите скрины по примерам и дождитесь проверки админа."
                  : null}
                {task.evidenceStageStatus === "approved"
                  ? "Скрины приняты — забери награду кнопкой ниже."
                  : null}
                {task.evidenceStageStatus === "rejected"
                  ? task.evidenceAdminNote?.trim()
                    ? `Отклонено: ${task.evidenceAdminNote.trim()} Загрузи новые скрины.`
                    : "Скрины отклонены — загрузи другие скрины."
                  : null}
              </p>
            ) : null}

            {task.requiresEvidence &&
            !done &&
            task.evidenceStageStatus === "submitted" ? (
              <div className="task-detail-pending-banner" role="status">
                <span className="task-detail-pending-banner__title">На рассмотрении</span>
                <p className="task-detail-pending-banner__text muted m-0">
                  Админ проверит скрины. Список заданий обновляется сам — как только
                  статус сменится, станет доступна кнопка «Получить награду» для этого
                  этапа, затем можно перейти к следующему.
                </p>
              </div>
            ) : null}

            {task.requiresEvidence && !done && task.evidenceStageStatus !== "approved" ? (
              task.evidenceStageStatus === "submitted" ? (
                <details className="task-detail-replace-evidence task-detail-modal__block">
                  <summary className="task-detail-replace-evidence__summary muted">
                    Заменить скрины (необязательно)
                  </summary>
                  <TaskEvidenceControls
                    inputId="task-detail-evidence-replace"
                    evidenceFiles={evidenceFiles}
                    onEvidenceFilesChange={onEvidenceFilesChange}
                    onSubmitEvidence={onSubmitEvidence}
                    evidenceUploading={evidenceUploading}
                    resubmit
                  />
                </details>
              ) : (
                <TaskEvidenceControls
                  inputId="task-detail-evidence"
                  evidenceFiles={evidenceFiles}
                  onEvidenceFilesChange={onEvidenceFilesChange}
                  onSubmitEvidence={onSubmitEvidence}
                  evidenceUploading={evidenceUploading}
                  resubmit={false}
                />
              )
            ) : null}

            {task.lastError ? <p className="err task-card__err">{task.lastError}</p> : null}

            <div className="task-detail-modal__actions">
              {actionUrl && !done ? (
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
                disabled={claiming || primaryDisabled}
                onClick={onClaim}
              >
                {primaryLabel}
              </button>
            </div>

            {showLinkHint ? (
              <p className="task-detail-link-hint muted">
                Сначала открой ссылку выше, затем нажми кнопку проверки или получения награды.
              </p>
            ) : null}
          </div>
        </div>
      </div>

      {showTaskHelpInUi(task) ? (
        <HelpSheetModal
          open={helpOpen}
          title={task.help!.title}
          body={task.help!.body}
          icon={task.help!.icon}
          onClose={() => setHelpOpen(false)}
        />
      ) : null}
    </div>
  );

  return createPortal(content, document.body);
}
