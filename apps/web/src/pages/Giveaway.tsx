import {
  ChevronLeft,
  ExternalLink,
  Share2,
  Ticket,
  Trophy,
  Users,
} from "lucide-react";
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
  platform: "twitch" | "kick" | "both";
  active: boolean;
  winnerCount: number;
  ticketPriceCoins: number;
  participantCount: number;
  drawnAt: string | null;
  winners: { rank: number; username: string }[];
  isParticipant: boolean;
  joinedAt: string | null;
  requireChannelSubscription: boolean;
  channelInviteUrl: string | null;
  channelSubscriptionOk: boolean | null;
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
  const completed = Boolean(g.drawnAt);
  const channelOk =
    !g.requireChannelSubscription ||
    g.channelSubscriptionOk === true;
  const structurallyCanJoin =
    g.active && !g.drawnAt && !ended && !g.isParticipant;

  const platformMismatch =
    (g.platform === "twitch" && activePlatform !== "twitch") ||
    (g.platform === "kick" && activePlatform !== "kick");

  const joinDisabled =
    joining ||
    !structurallyCanJoin ||
    !channelOk ||
    platformMismatch ||
    (g.ticketPriceCoins > 0 &&
      (activePlatform === "twitch"
        ? me.platforms.twitch.status !== "connected"
        : me.platforms.kick.status !== "connected"));

  function openChannel(url: string) {
    const wa = WebApp as { openTelegramLink?: (u: string) => void };
    if (typeof wa.openTelegramLink === "function") {
      wa.openTelegramLink(url);
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }

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

      {platformMismatch && structurallyCanJoin ? (
        <div className="card giveaway-detail__hint" style={{ borderColor: "var(--danger)" }}>
          <p className="muted m-0" style={{ fontSize: 14 }}>
            Переключите платформу в шапке на{" "}
            <strong>{g.platform === "twitch" ? "Twitch" : "Kick"}</strong> — для
            этого розыгрыша участие только с этой платформы.
          </p>
        </div>
      ) : null}

      {completed ? (
        <div className="card giveaway-detail__completed">
          <strong className="giveaway-detail__completed-title">
            Розыгрыш завершён
          </strong>
          <p className="muted giveaway-detail__completed-meta">
            Участников: {g.participantCount.toLocaleString("ru-RU")} · Победителей:{" "}
            {g.winnerCount}
            {g.requireChannelSubscription ? " · Условие: подписка на канал" : ""}
          </p>
        </div>
      ) : null}

      <div className="giveaway-detail__stats">
        <div className="giveaway-stat">
          <span className="giveaway-stat__label">До конца</span>
          <span className="giveaway-stat__val">
            {completed ? "—" : ended ? "—" : formatCountdownFull(g.endsAt)}
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

      {g.drawnAt && (
        <div className="card stack giveaway-detail__winners">
          <h2 className="giveaway-detail__h2">Победители</h2>
          {g.winners.length > 0 ? (
            <ul className="giveaway-detail__win-list">
              {g.winners.map((w) => (
                <li key={w.rank}>
                  <span className="giveaway-detail__win-rank">{w.rank}</span>
                  <span className="giveaway-detail__win-name">{w.username}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Список победителей пока не отображается.</p>
          )}
        </div>
      )}

      {g.isParticipant && !g.drawnAt && (
        <p className="muted giveaway-detail__hint">
          Вы в списке участников. Итоги после окончания розыгрыша.
        </p>
      )}

      {!completed &&
        g.requireChannelSubscription &&
        !g.isParticipant && (
          <div className="card giveaway-detail__channel-req">
            <p className="giveaway-detail__channel-req-title">Условие участия</p>
            <p className="muted giveaway-detail__channel-req-text">
              Подписка на канал. Откройте канал и подпишитесь, затем нажмите «Участвовать».
            </p>
            {g.channelInviteUrl ? (
              <button
                type="button"
                className="secondary giveaway-detail__channel-btn"
                onClick={() => openChannel(g.channelInviteUrl!)}
              >
                <ExternalLink size={18} aria-hidden />
                Перейти в канал
              </button>
            ) : (
              <p className="muted">Ссылку на канал уточните у администратора.</p>
            )}
            <button
              type="button"
              className="link-like giveaway-detail__refresh-sub"
              onClick={() => void load()}
            >
              Обновить статус подписки
            </button>
            {g.channelSubscriptionOk === false ? (
              <p className="muted giveaway-detail__channel-hint">
                Подписка ещё не видна боту — подождите минуту и обновите статус.
              </p>
            ) : g.channelSubscriptionOk === true ? (
              <p className="muted giveaway-detail__channel-hint giveaway-detail__channel-hint--ok">
                Подписка подтверждена.
              </p>
            ) : null}
          </div>
        )}

      {structurallyCanJoin && (
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

      {g.ticketPriceCoins > 0 && structurallyCanJoin && (
        <p className="muted giveaway-balance-hint">
          Баланс {activePlatform === "twitch" ? "Twitch" : "Kick"}:{" "}
          {balance.toLocaleString("ru-RU")} · переключите платформу в шапке.
        </p>
      )}

      {ended && !g.drawnAt && (
        <p className="muted">Приём участников окончен, ожидается выбор победителей.</p>
      )}

      {!g.active && !completed && (
        <p className="muted">Розыгрыш отключён администратором.</p>
      )}

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
