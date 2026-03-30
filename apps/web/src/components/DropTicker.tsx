import { useMemo } from "react";

function formatMmSs(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Бегущая строка сверху экрана — по тапу открывается попап дропа.
 */
export function DropTicker({
  secondsLeft,
  onOpen,
}: {
  secondsLeft: number;
  onOpen: () => void;
}) {
  const line = useMemo(() => {
    const t = formatMmSs(secondsLeft);
    return `🎁 Активный DROP — введи код со стрима · осталось ${t} · нажми, чтобы открыть`;
  }, [secondsLeft]);

  return (
    <button
      type="button"
      className="drop-ticker"
      onClick={onOpen}
      aria-label="Открыть дроп"
    >
      <div className="drop-ticker__fade drop-ticker__fade--left" aria-hidden />
      <div className="drop-ticker__fade drop-ticker__fade--right" aria-hidden />
      <div className="drop-ticker__track">
        <span className="drop-ticker__text">{line}</span>
        <span className="drop-ticker__text" aria-hidden>
          {line}
        </span>
        <span className="drop-ticker__text" aria-hidden>
          {line}
        </span>
      </div>
    </button>
  );
}
