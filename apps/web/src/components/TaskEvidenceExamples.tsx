import { useEffect, useState } from "react";
import type { TaskEvidenceExample } from "shared";

export function TaskEvidenceExamples({
  examples,
}: {
  examples: TaskEvidenceExample[];
}) {
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreview(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [preview]);

  if (!examples.length) return null;

  return (
    <>
      <details className="task-evidence-examples">
        <summary className="task-evidence-examples__summary">
          Показать примеры скриншотов
        </summary>
        <div className="task-evidence-examples__grid">
          {examples.map((ex, i) => (
            <button
              key={`${ex.src}-${i}`}
              type="button"
              className="task-evidence-examples__thumb"
              onClick={() => setPreview(ex.src)}
            >
              <img
                src={ex.src}
                alt={ex.caption ?? `Пример ${i + 1}`}
                loading="lazy"
                decoding="async"
              />
              {ex.caption ? (
                <span className="task-evidence-examples__caption">
                  {ex.caption}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      </details>

      {preview ? (
        <div
          className="task-evidence-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="Просмотр примера"
          onClick={() => setPreview(null)}
        >
          <button
            type="button"
            className="task-evidence-lightbox__close"
            aria-label="Закрыть"
          >
            ×
          </button>
          <img
            src={preview}
            alt=""
            className="task-evidence-lightbox__img"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}
    </>
  );
}
