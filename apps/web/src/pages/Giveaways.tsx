import { ChevronLeft } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { GiveawayListItemDto } from "../query/fetchers";
import { useGiveawaysList } from "../hooks/queries/useGiveaways";
import { PageSkeleton } from "../components/PageSkeleton";
import { ResponsivePicture } from "../components/ResponsivePicture";

function formatCountdown(iso: string): string {
  const end = new Date(iso).getTime();
  const now = Date.now();
  const ms = Math.max(0, end - now);
  const d = Math.floor(ms / (24 * 60 * 60 * 1000));
  const h = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  return `${d} дн. ${h} ч.`;
}

function statusLabel(s: GiveawayListItemDto["status"]): string {
  if (s === "completed") return "Завершён";
  if (s === "ended_awaiting_draw") return "Ожидает итогов";
  return "Активен";
}

function platformShort(p: GiveawayListItemDto["platform"]): string {
  if (p === "both") return "Twitch · Kick";
  return p === "twitch" ? "Twitch" : "Kick";
}

export default function GiveawaysPage() {
  const { data: items, isPending, isError, refetch, isFetching } =
    useGiveawaysList();
  const [tab, setTab] = useState<"active" | "done">("active");

  const filtered = useMemo(() => {
    const list = items ?? [];
    if (tab === "active") {
      return list.filter(
        (g) => g.status === "live" || g.status === "ended_awaiting_draw"
      );
    }
    return list.filter((g) => g.status === "completed");
  }, [items, tab]);

  return (
    <div className="giveaways-list-page stack">
      <Link to="/" className="giveaways-list-page__back">
        <ChevronLeft size={22} />
        Назад
      </Link>

      <div className="segment" role="tablist" aria-label="Розыгрыши">
        <button
          type="button"
          className={tab === "active" ? "on" : ""}
          onClick={() => setTab("active")}
        >
          Активные
        </button>
        <button
          type="button"
          className={tab === "done" ? "on" : ""}
          onClick={() => setTab("done")}
        >
          Завершённые
        </button>
      </div>

      {isError ? (
        <div className="card stack">
          <p className="err">Не удалось загрузить список розыгрышей.</p>
          <button
            type="button"
            className="primary"
            onClick={() => void refetch()}
          >
            Повторить
          </button>
        </div>
      ) : null}

      {isPending ? (
        <PageSkeleton />
      ) : isError ? null : filtered.length === 0 ? (
        <p className="muted">
          {tab === "active"
            ? "Нет активных розыгрышей."
            : "Пока нет завершённых розыгрышей."}
        </p>
      ) : (
        <>
          {isFetching && !isPending ? (
            <p className="muted">Обновляем список…</p>
          ) : null}
          <div
            className={
              filtered.length === 1
                ? "giveaways-grid giveaways-grid--single"
                : "giveaways-grid"
            }
          >
          {filtered.map((g) => (
            <Link
              key={g.id}
              to={`/giveaway/${g.id}`}
              className="card giveaway-card giveaway-card--link"
            >
              {g.imageMedia ? (
                <div className="giveaway-card__picture-wrap">
                  <ResponsivePicture
                    image={g.imageMedia}
                    alt=""
                    sizes="(max-width: 640px) 50vw, 280px"
                    layout="fill"
                  />
                </div>
              ) : g.imageUrl ? (
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
                <p className="giveaway-card__headline">{g.prizeText}</p>
                <p className="giveaway-card__meta muted">
                  {platformShort(g.platform)} ·{" "}
                  {g.participantCount.toLocaleString("ru-RU")} уч. ·{" "}
                  {g.winnerCount} поб. ·{" "}
                  {g.ticketPriceCoins > 0
                    ? `билет ${g.ticketPriceCoins} мон.`
                    : "бесплатно"}
                </p>
                <div className="giveaway-card__timer">
                  <span className="giveaway-card__status-label">
                    {statusLabel(g.status)}
                  </span>
                  {g.status === "completed"
                    ? g.drawnAt
                      ? ` · ${new Date(g.drawnAt).toLocaleString("ru-RU", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}`
                      : ""
                    : ` · ${formatCountdown(g.endsAt)}`}
                </div>
              </div>
            </Link>
          ))}
          </div>
        </>
      )}
    </div>
  );
}
