import { ShieldOff, Send } from "lucide-react";
import { useCallback, useState } from "react";
import { api, formatApiError } from "../api";
import { useToast } from "../context/ToastContext";

export default function BannedScreen({
  displayName,
  banReason,
  appealPending,
  onRefresh,
}: {
  displayName: string;
  banReason: string | null;
  appealPending: boolean;
  onRefresh: () => void;
}) {
  const { showToast } = useToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const submit = useCallback(async () => {
    const t = text.trim();
    if (t.length < 10) {
      showToast("Минимум 10 символов", "error");
      return;
    }
    setSending(true);
    const r = await api<{ ok: boolean }>("/api/v1/ban-appeal", {
      method: "POST",
      body: JSON.stringify({ message: t }),
    });
    setSending(false);
    if (!r.ok) {
      showToast(formatApiError(r), "error");
      return;
    }
    showToast("Апелляция отправлена администратору", "success");
    setModalOpen(false);
    setText("");
    onRefresh();
  }, [text, onRefresh, showToast]);

  return (
    <div className="banned-screen">
      <div className="banned-screen__glow" aria-hidden />
      <div className="banned-screen__inner">
        <div className="banned-screen__icon-wrap">
          <ShieldOff size={40} strokeWidth={1.8} className="banned-screen__icon" />
        </div>
        <h1 className="banned-screen__title">Доступ ограничен</h1>
        <p className="banned-screen__lead">
          {displayName}, ваш аккаунт заблокирован в этом приложении.
        </p>

        <div className="card banned-screen__reason">
          <p className="banned-screen__reason-label">Причина</p>
          <p className="banned-screen__reason-text">
            {banReason?.trim()
              ? banReason
              : "Причина не указана администратором."}
          </p>
        </div>

        {appealPending ? (
          <p className="banned-screen__pending muted">
            Ваша апелляция отправлена и ожидает рассмотрения. Решение примет
            администратор.
          </p>
        ) : (
          <button
            type="button"
            className="primary banned-screen__cta"
            onClick={() => setModalOpen(true)}
          >
            <Send size={20} aria-hidden />
            Подать апелляцию
          </button>
        )}

        <p className="banned-screen__foot muted">
          Если считаете блокировку ошибкой — опишите ситуацию в апелляции.
        </p>
        <button
          type="button"
          className="link-like banned-screen__refresh"
          onClick={() => void onRefresh()}
        >
          Обновить статус
        </button>
      </div>

      {modalOpen ? (
        <div
          className="banned-screen__modal-backdrop"
          role="presentation"
          onClick={() => !sending && setModalOpen(false)}
        >
          <div
            className="card banned-screen__modal"
            role="dialog"
            aria-labelledby="appeal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="appeal-title" className="banned-screen__modal-title">
              Апелляция
            </h2>
            <p className="muted banned-screen__modal-hint">
              Расскажите, почему считаете блокировку несправедливой. Текст увидит
              только администратор.
            </p>
            <textarea
              className="banned-screen__textarea"
              rows={6}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Не менее 10 символов…"
              maxLength={4000}
              disabled={sending}
            />
            <div className="banned-screen__modal-actions">
              <button
                type="button"
                className="secondary"
                disabled={sending}
                onClick={() => setModalOpen(false)}
              >
                Отмена
              </button>
              <button
                type="button"
                className="primary"
                disabled={sending || text.trim().length < 10}
                onClick={() => void submit()}
              >
                {sending ? "…" : "Отправить"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
