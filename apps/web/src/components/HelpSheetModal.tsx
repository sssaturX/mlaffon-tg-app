import { CircleHelp, Gift, Radio, Tv, X } from "lucide-react";
import type { TaskHelpIcon } from "shared";

function HelpIcon({ kind }: { kind?: TaskHelpIcon }) {
  const k = kind ?? "help";
  const common = { size: 28, strokeWidth: 2, className: "help-sheet__icon-svg" };
  if (k === "tv") return <Tv {...common} aria-hidden />;
  if (k === "gift") return <Gift {...common} aria-hidden />;
  if (k === "radio") return <Radio {...common} aria-hidden />;
  return <CircleHelp {...common} aria-hidden />;
}

export function HelpSheetModal({
  open,
  title,
  body,
  icon,
  onClose,
}: {
  open: boolean;
  title: string;
  body: string;
  icon?: TaskHelpIcon;
  onClose: () => void;
}) {
  if (!open) return null;

  return (
    <div
      className="help-sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-sheet-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="help-sheet-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="help-sheet-modal__head">
          <h2 id="help-sheet-title" className="help-sheet-modal__title">
            {title}
          </h2>
          <button
            type="button"
            className="help-sheet-modal__close"
            aria-label="Закрыть"
            onClick={onClose}
          >
            <X size={20} strokeWidth={2.2} />
          </button>
        </div>
        <div className="help-sheet-modal__divider" aria-hidden />
        <div className="help-sheet-modal__row">
          <div className="help-sheet__icon-wrap">
            <HelpIcon kind={icon} />
          </div>
          <p className="help-sheet-modal__text">{body}</p>
        </div>
      </div>
    </div>
  );
}
