import { ChevronLeft } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { MeResponse } from "shared";
import { api, formatApiError } from "../api";
import { useToast } from "../context/ToastContext";
import { PageSkeleton } from "../components/PageSkeleton";

type GiveawayListItem = {
  id: string;
  title: string;
  prizeText: string;
  imageUrl: string | null;
  endsAt: string;
  winnerCount: number;
  ticketPriceCoins: number;
  participantCount: number;
  drawnAt: string | null;
  active: boolean;
  status: "live" | "ended_awaiting_draw" | "completed";
};

function formatCountdown(iso: string): string {
  const end = new Date(iso).getTime();
  const now = Date.now();
  const ms = Math.max(0, end - now);
  const d = Math.floor(ms / (24 * 60 * 60 * 1000));
  const h = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  return `${d} дн. ${h} ч.`;
}

function statusLabel(s: GiveawayListItem["status"]): string {
  if (s === "completed") return "Завершён";
  if (s === "ended_awaiting_draw") return "Ожидает итогов";
  return "Активен";
}

export default function GiveawaysPage({ me }: { me: MeResponse | null }) {
  const { showToast } = useToast();
  const [items, setItems] = useState<GiveawayListItem[] | null>(null);

  const load = useCallback(async () => {
    const r = await api<{ giveaways: GiveawayListItem[] }>("/api/v1/giveaways");
    if (r.ok) setItems(r.data.giveaways);
    else showToast(formatApiError(r), "error");
  }, [showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!me) {
    return <PageSkeleton />;
  }

  return (
    <div className="giveaways-list-page stack">
      <Link to="/" className="giveaways-list-page__back">
        <ChevronLeft size={22} />
        Назад
      </Link>
      <h2 className="giveaways-list-page__title">Все розыгрыши</h2>
      {items === null ? (
        <PageSkeleton />
      ) : items.length === 0 ? (
        <p className="muted">Пока нет розыгрышей.</p>
      ) : (
        <div className="stack">
          {items.map((g) => (
            <Link
              key={g.id}
              to={`/giveaway/${g.id}`}
              className="card giveaway-card giveaway-card--link"
            >
              {g.imageUrl ? (
                <img
                  src={g.imageUrl}
                  alt=""
                  className="giveaway-card__img"
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <div className="giveaway-card__placeholder" aria-hidden />
              )}
              <div className="giveaway-card__body">
                <p className="giveaway-card__status muted">{statusLabel(g.status)}</p>
                <p className="giveaway-card__prize">{g.prizeText}</p>
                <p className="giveaway-card__title">{g.title}</p>
                <p className="giveaway-card__meta muted">
                  {g.participantCount.toLocaleString("ru-RU")} уч. · {g.winnerCount}{" "}
                  победител
                  {g.winnerCount === 1 ? "ь" : g.winnerCount < 5 ? "я" : "ей"}
                  {g.ticketPriceCoins > 0
                    ? ` · билет ${g.ticketPriceCoins} мон.`
                    : " · бесплатно"}
                </p>
                <div className="giveaway-card__timer">
                  {g.status === "completed"
                    ? g.drawnAt
                      ? `Итоги: ${new Date(g.drawnAt).toLocaleString("ru-RU", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}`
                      : "Завершён"
                    : formatCountdown(g.endsAt)}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
