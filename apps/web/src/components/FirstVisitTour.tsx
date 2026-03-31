import { Home } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useState,
} from "react";

const STORAGE_KEY = "mlaffon_tour_v4_done";

type SpotlightTarget = "platform-toggle" | "nav-tasks";

type TourStep =
  | {
      kind: "spotlight";
      target: SpotlightTarget;
      title: string;
      body: string;
      bullets: { k: string; v: string }[];
    }
  | {
      kind: "card";
      title: string;
      body: string;
      bullets: { k: string; v: string }[];
      visual: "home";
    };

const STEPS: TourStep[] = [
  {
    kind: "spotlight",
    target: "platform-toggle",
    title: "Переключение платформы",
    body:
      "Вверху выбери Twitch или Kick — от этого зависят баланс, задания и стрик.",
    bullets: [
      { k: "Шапка", v: "баланс выбранной платформы" },
      { k: "Ниже", v: "контент под выбранную площадку" },
    ],
  },
  {
    kind: "spotlight",
    target: "nav-tasks",
    title: "Задания",
    body:
      "Раздел «Задания» — карточки с наградами: открой задание, подпишись по ссылке и нажми проверку.",
    bullets: [
      { k: "Карточка", v: "нажми, чтобы открыть детали" },
      { k: "Кнопки", v: "переход и проверка подписки" },
    ],
  },
  {
    kind: "card",
    title: "Главная и меню",
    body:
      "На главной статистика и розыгрыши; нижнее меню ведёт в игры, магазин и профиль.",
    bullets: [
      { k: "Навигация", v: "всегда внизу экрана" },
      { k: "Профиль", v: "OAuth Twitch и Kick" },
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

function TourVisualHome() {
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
  const safeStep = Math.min(Math.max(0, step), STEPS.length - 1);
  const s = STEPS[safeStep]!;
  const last = safeStep >= STEPS.length - 1;

  const [hole, setHole] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);

  const [tooltipPos, setTooltipPos] = useState<{
    top?: number;
    bottom?: number;
  }>({});

  const measureSpotlight = useCallback(() => {
    if (!open || s.kind !== "spotlight") {
      setHole(null);
      setTooltipPos({});
      return;
    }
    const el = document.querySelector(
      `[data-tour-target="${s.target}"]`
    ) as HTMLElement | null;
    if (!el) {
      setHole(null);
      setTooltipPos({});
      return;
    }
    const r = el.getBoundingClientRect();
    const pad = 10;
    const h = {
      left: r.left - pad,
      top: r.top - pad,
      width: r.width + pad * 2,
      height: r.height + pad * 2,
    };
    setHole(h);
    const vh =
      typeof window !== "undefined" ? window.innerHeight : 600;
    if (s.target === "nav-tasks") {
      setTooltipPos({
        bottom: vh - h.top + 8,
        top: undefined,
      });
    } else {
      setTooltipPos({
        top: Math.min(h.top + h.height + 14, vh - 200),
        bottom: undefined,
      });
    }
  }, [open, s]);

  useLayoutEffect(() => {
    measureSpotlight();
  }, [measureSpotlight]);

  useEffect(() => {
    if (!open) return;
    const onResize = () => measureSpotlight();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("scroll", onResize, true);
    };
  }, [open, measureSpotlight]);

  if (!open) return null;

  const spotlight = s.kind === "spotlight";

  return (
    <div
      className={`tour-overlay ${spotlight ? "tour-overlay--spotlight" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-title"
    >
      {spotlight && hole ? (
        <>
          <div className="tour-spotlight-layer" aria-hidden>
            <div
              className="tour-spotlight-hole"
              style={{
                left: hole.left,
                top: hole.top,
                width: hole.width,
                height: hole.height,
              }}
            />
          </div>
          <div
            className="tour-spotlight-tooltip"
            style={{
              top: Math.min(
                hole.top + hole.height + 14,
                typeof window !== "undefined"
                  ? window.innerHeight - 220
                  : hole.top + hole.height + 14
              ),
            }}
          >
            <div className="tour-spotlight-tooltip__arrow" aria-hidden />
            <div className="tour-spotlight-tooltip__inner">
              <div className="tour-card__steps" aria-hidden>
                {STEPS.map((_, i) => (
                  <span
                    key={i}
                    className={`tour-dot ${i === safeStep ? "tour-dot--active" : ""}`}
                  />
                ))}
              </div>
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
              <div className="tour-card__actions tour-card__actions--spread">
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
                {safeStep > 0 ? (
                  <button
                    type="button"
                    onClick={() => onStepChange(safeStep - 1)}
                  >
                    Назад
                  </button>
                ) : null}
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
        </>
      ) : (
        <div className="tour-shell">
          <div className="tour-card tour-card--enter">
            <div className="tour-card__steps" aria-hidden>
              {STEPS.map((_, i) => (
                <span
                  key={i}
                  className={`tour-dot ${i === safeStep ? "tour-dot--active" : ""}`}
                />
              ))}
            </div>
            {s.kind === "card" ? <TourVisualHome /> : null}
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
            <div className="tour-card__actions tour-card__actions--spread">
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
              {safeStep > 0 ? (
                <button
                  type="button"
                  onClick={() => onStepChange(safeStep - 1)}
                >
                  Назад
                </button>
              ) : null}
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
      )}
    </div>
  );
}
