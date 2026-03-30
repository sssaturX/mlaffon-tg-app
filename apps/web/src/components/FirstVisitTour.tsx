import {
  ChevronRight,
  Home,
  LayoutGrid,
  Sparkles,
  Users,
} from "lucide-react";

const STORAGE_KEY = "mlaffon_tour_v3_done";

const STEPS: {
  title: string;
  body: string;
  bullets: { k: string; v: string }[];
  visual: "platform" | "referral" | "home";
}[] = [
  {
    title: "Переключение платформы",
    body:
      "Вверху экрана выбери Twitch или Kick — от этого зависят баланс в шапке, задания и стрик.",
    bullets: [
      { k: "Шапка", v: "баланс выбранной платформы" },
      { k: "Задания / игры", v: "считаются для активной платформы" },
    ],
    visual: "platform",
  },
  {
    title: "Рефералы",
    body:
      "Проценты рефералам начисляются раз в неделю (UTC), если приглашённый подключил Twitch или Kick.",
    bullets: [
      { k: "Уровень 1", v: "прямой реферал" },
      { k: "Уровень 2", v: "реферал реферала" },
    ],
    visual: "referral",
  },
  {
    title: "Главная",
    body:
      "Здесь общая статистика, розыгрыши и блок с ответами — всё можно раскрыть в FAQ ниже.",
    bullets: [
      { k: "Статистика", v: "пользователи и монеты по проекту" },
      { k: "Нижнее меню", v: "разделы приложения" },
    ],
    visual: "home",
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

function TourVisual({ kind }: { kind: "platform" | "referral" | "home" }) {
  if (kind === "platform") {
    return (
      <div className="tour-visual tour-visual--platform" aria-hidden>
        <div className="tour-visual__caption">Шапка приложения</div>
        <div className="tour-mock-header">
          <div className="tour-mock-toggle">
            <span className="tour-mock-toggle__opt tour-mock-toggle__opt--on">
              <LayoutGrid size={14} /> Twitch
            </span>
            <span className="tour-mock-toggle__opt">Kick</span>
          </div>
          <div className="tour-mock-balance">
            <Sparkles size={14} /> 1 234
          </div>
        </div>
        <p className="tour-visual__hint">Переключатель влияет на весь контент ниже</p>
      </div>
    );
  }
  if (kind === "referral") {
    return (
      <div className="tour-visual tour-visual--referral" aria-hidden>
        <div className="tour-visual__caption">Профиль → рефералы</div>
        <div className="tour-mock-ref">
          <Users size={20} strokeWidth={2} className="tour-mock-ref__icon" />
          <div>
            <div className="tour-mock-ref__line" />
            <div className="tour-mock-ref__line tour-mock-ref__line--short" />
          </div>
          <ChevronRight size={18} className="muted" />
        </div>
      </div>
    );
  }
  return (
    <div className="tour-visual tour-visual--home" aria-hidden>
      <div className="tour-visual__caption">Нижняя навигация</div>
      <div className="tour-mock-nav">
        <span className="tour-mock-nav__item tour-mock-nav__item--active">
          <Home size={18} />
          <small>Главная</small>
        </span>
        <span className="tour-mock-nav__item">
          <small>…</small>
        </span>
        <span className="tour-mock-nav__item">
          <small>…</small>
        </span>
      </div>
    </div>
  );
}

export function FirstVisitTour({
  open,
  step,
  onStepChange,
  onClose,
}: {
  open: boolean;
  step: number;
  onStepChange: (n: number) => void;
  onClose: () => void;
}) {
  if (!open) return null;

  const safeStep = Math.min(Math.max(0, step), STEPS.length - 1);
  const s = STEPS[safeStep]!;
  const last = safeStep >= STEPS.length - 1;

  return (
    <div
      className="tour-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-title"
    >
      <div className="tour-shell">
        <div className="tour-card">
          <div className="tour-card__steps" aria-hidden>
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={`tour-dot ${i === safeStep ? "tour-dot--active" : ""}`}
              />
            ))}
          </div>
          <TourVisual kind={s.visual} />
          <p className="tour-card__step-label">
            Шаг {safeStep + 1} из {STEPS.length}
          </p>
          <h2 id="tour-title" className="tour-card__title">
            {s.title}
          </h2>
          <p className="tour-card__body">{s.body}</p>
          <ul className="tour-bullets">
            {s.bullets.map((b) => (
              <li key={b.k}>
                <span className="tour-bullets__k">{b.k}</span>
                <span className="tour-bullets__v">{b.v}</span>
              </li>
            ))}
          </ul>
          <div className="tour-card__actions">
            <button
              type="button"
              className="link-like"
              onClick={() => {
                markTourSeen();
                onClose();
              }}
            >
              Пропустить
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => {
                if (last) {
                  markTourSeen();
                  onClose();
                } else onStepChange(safeStep + 1);
              }}
            >
              {last ? "Понятно" : "Далее"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
