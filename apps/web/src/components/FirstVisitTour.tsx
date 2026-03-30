import { useEffect, useState } from "react";

const STORAGE_KEY = "mlaffon_tour_v2_done";

const STEPS = [
  {
    title: "Платформы",
    body: "В шапке переключай Twitch и Kick: баланс и задания считаются для выбранной платформы.",
  },
  {
    title: "Рефералы",
    body: "Проценты рефералам начисляются раз в неделю (UTC), если приглашённый подключил Twitch или Kick.",
  },
  {
    title: "Главная",
    body: "Здесь общая статистика, розыгрыши, кэшбек и ответы в FAQ.",
  },
];

export function hasSeenTour(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return true;
  }
}

export function markTourSeen() {
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function FirstVisitTour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  if (!open) return null;

  const s = STEPS[step]!;
  const last = step >= STEPS.length - 1;

  return (
    <div className="tour-overlay" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      <div className="tour-card card">
        <p className="muted" style={{ margin: 0, fontSize: 11 }}>
          Подсказка {step + 1} / {STEPS.length}
        </p>
        <h2 id="tour-title" style={{ margin: "6px 0 8px", fontSize: 18 }}>
          {s.title}
        </h2>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.45 }}>{s.body}</p>
        <div className="row" style={{ marginTop: 16, justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="link-like" onClick={() => { markTourSeen(); onClose(); }}>
            Пропустить
          </button>
          <button
            type="button"
            className="primary"
            onClick={() => {
              if (last) {
                markTourSeen();
                onClose();
              } else setStep((x) => x + 1);
            }}
          >
            {last ? "Понятно" : "Далее"}
          </button>
        </div>
      </div>
    </div>
  );
}
