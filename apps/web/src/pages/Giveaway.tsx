import { ChevronLeft, Share2, Ticket, Trophy, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import WebApp from "@twa-dev/sdk";
import type { MeResponse } from "shared";
import { api, formatApiError } from "../api";
import { useToast } from "../context/ToastContext";
import { useActivePlatform } from "../context/PlatformContext";
import { PageSkeleton } from "../components/PageSkeleton";

type GiveawayDetail = {
  id: string;
  title: string;
  prizeText: string;
  description: string | null;
  imageUrl: string | null;
  endsAt: string;
  active: boolean;
  winnerCount: number;
  ticketPriceCoins: number;
  participantCount: number;
  drawnAt: string | null;
  winners: { rank: number; username: string }[];
  isParticipant: boolean;
  joinedAt: string | null;
};

function formatCountdownFull(iso: string): string {
  const end = new Date(iso).getTime();
  const now = Date.now();
  const ms = Math.max(0, end - now);
  const d = Math.floor(ms / (24 * 60 * 60 * 1000));
  const h = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const m = Math.floor((ms % (60 * 60 * 1000)) / (60 * 1000));
  return `${d}д ${h}ч ${m}м`;
}

export default function GiveawayPage({
  me,
  onRefresh,
}: {
  me: MeResponse | null;
  onRefresh: () => void;
}) {
  const { id } = useParams<{ id: string }>();
  const { showToast } = useToast();
  const { activePlatform } = useActivePlatform();
  const [data, setData] = useState<GiveawayDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const r = await api<GiveawayDetail>(`/api/v1/giveaways/${id}`);
    if (r.ok) setData(r.data);
    else showToast(formatApiError(r), "error");
    setLoading(false);
  }, [id, showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function join() {
    if (!id || !data) return;
    setJoining(true);
    const r = await api<{ ok: boolean; joinedAt: string }>(
      `/api/v1/giveaways/${id}/join`,
      {
        method: "POST",
        body: JSON.stringify({ platform: activePlatform }),
      }
    );
    setJoining(false);
    if (!r.ok) {
      showToast(formatApiError(r), "error");
      return;
    }
    showToast("Вы участвуете в розыгрыше", "success");
    onRefresh();
    await load();
  }

  async function share() {
    if (!data) return;
    const url =
      typeof window !== "undefined" ? window.location.href : "";
    const text = `${data.title} — ${data.prizeText}`;
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ title: data.title, text, url });
        return;
      }
    } catch {
      /* ignore */
    }
    try {
      const wa = WebApp as { openTelegramLink?: (u: string) => void };
      const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
      if (typeof wa.openTelegramLink === "function") {
        wa.openTelegramLink(shareUrl);
        return;
      }
    } catch {
      /* ignore */
    }
    showToast("Ссылка скопирована в буфер", "info");
    try {
      await navigator.clipboard.writeText(`${text}\n${url}`);
    } catch {
      /* ignore */
    }
  }

  if (!me) {
    return <PageSkeleton />;
  }

  if (loading || !data) {
    return (
      <div className="giveaway-detail">
        <Link to="/" className="giveaway-detail__back">
          <ChevronLeft size={22} />
          Назад
        </Link>
        {loading ? (
          <PageSkeleton />
        ) : (
          <p className="muted">Не найдено</p>
        )}
      </div>
    );
  }

  const g = data;
  const ended = new Date(g.endsAt) <= new Date();
  const canJoin =
    g.active &&
    !g.drawnAt &&
    !ended &&
    !g.isParticipant;

  const joinDisabled =
    joining ||
    !canJoin ||
    (g.ticketPriceCoins > 0 &&
      (activePlatform === "twitch"
        ? me.platforms.twitch.status !== "connected"
        : me.platforms.kick.status !== "connected"));

  const balance =
    activePlatform === "twitch" ? me.coinsTwitch : me.coinsKick;

  return (
    <div className="giveaway-detail">
      <div className="giveaway-detail__hero">
        <Link to="/" className="giveaway-detail__back" aria-label="Назад">
          <ChevronLeft size={22} />
        </Link>
        {g.imageUrl ? (
          <img
            src={g.imageUrl}
            alt=""
            className="giveaway-detail__banner"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="giveaway-detail__banner giveaway-detail__banner--ph" />
        )}
        <h1 className="giveaway-detail__title">{g.title}</h1>
      </div>

      <div className="giveaway-detail__prize card">
        <Trophy size={18} className="giveaway-detail__prize-icon" aria-hidden />
        <span>{g.prizeText}</span>
      </div>

      {g.description ? (
        <div className="card giveaway-detail__desc">
          <p className="giveaway-detail__desc-text">{g.description}</p>
        </div>
      ) : null}

      <div className="giveaway-detail__stats">
        <div className="giveaway-stat">
          <span className="giveaway-stat__label">До конца</span>
          <span className="giveaway-stat__val">
            {ended ? "—" : formatCountdownFull(g.endsAt)}
          </span>
        </div>
        <div className="giveaway-stat">
          <span className="giveaway-stat__label">
            <Users size={14} aria-hidden /> Участников
          </span>
          <span className="giveaway-stat__val">
            {g.participantCount.toLocaleString("ru-RU")}
          </span>
        </div>
        <div className="giveaway-stat">
          <span className="giveaway-stat__label">Победителей</span>
          <span className="giveaway-stat__val">{g.winnerCount}</span>
        </div>
      </div>

      {g.drawnAt && g.winners.length > 0 && (
        <div className="card stack giveaway-detail__winners">
          <h2 className="giveaway-detail__h2">Победители</h2>
          <ul className="giveaway-detail__win-list">
            {g.winners.map((w) => (
              <li key={w.rank}>
                <span className="giveaway-detail__win-rank">{w.rank}</span>
                <span className="giveaway-detail__win-name">{w.username}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {g.isParticipant && !g.drawnAt && (
        <p className="muted giveaway-detail__hint">
          Вы в списке участников. Итоги после окончания розыгрыша.
        </p>
      )}

      {canJoin && (
        <button
          type="button"
          className="primary giveaway-detail__cta"
          disabled={joinDisabled}
          onClick={() => void join()}
        >
          <Ticket size={20} aria-hidden />
          {g.ticketPriceCoins === 0
            ? "Участвовать бесплатно"
            : `Купить билет за ${g.ticketPriceCoins.toLocaleString("ru-RU")} ${
                activePlatform === "twitch" ? "Twitch" : "Kick"
              } мон.`}
        </button>
      )}

      {g.ticketPriceCoins > 0 && canJoin && (
        <p className="muted giveaway-balance-hint">
          Баланс {activePlatform === "twitch" ? "Twitch" : "Kick"}:{" "}
          {balance.toLocaleString("ru-RU")} · переключите платформу в шапке.
        </p>
      )}

      {ended && !g.drawnAt && (
        <p className="muted">Розыгрыш завершён, ожидается выбор победителей.</p>
      )}

      {!g.active && <p className="muted">Розыгрыш отключён администратором.</p>}

      <button
        type="button"
        className="secondary giveaway-detail__share"
        onClick={() => void share()}
      >
        <Share2 size={18} aria-hidden />
        Поделиться
      </button>
    </div>
  );
}
