import { useCallback, useEffect, useMemo, useState, memo } from "react";
import { Coins, ShoppingBag, Sparkles, Crown, Gamepad2, Shield, Gift, Zap, Star, Tag } from "lucide-react";
import { api, formatApiError } from "../api";
import { useMeEconomySync } from "../context/MeEconomySyncContext";
import { scheduleSmartRefresh } from "../services/meService";
import { useActivePlatform } from "../context/PlatformContext";
import { PageSkeleton } from "../components/PageSkeleton";

type Item = {
  id: string;
  title: string;
  kind: string;
  priceCoins: number;
};

type PlaceholderItem = {
  id: string;
  title: string;
  icon: React.ReactNode;
  accent: string;
};

const twitchPlaceholders: PlaceholderItem[] = [
  { id: "tw_vip", title: "VIP в чате", icon: <Crown size={22} />, accent: "#a855f7" },
  { id: "tw_bp", title: "Battle Pass", icon: <Gamepad2 size={22} />, accent: "#c084fc" },
  { id: "tw_steam", title: "Пополнение Steam", icon: <Gift size={22} />, accent: "#818cf8" },
  { id: "tw_vpn", title: "VPN / прокси", icon: <Shield size={22} />, accent: "#7c3aed" },
];

const kickPlaceholders: PlaceholderItem[] = [
  { id: "ki_vip", title: "VIP в чате", icon: <Crown size={22} />, accent: "#53fc18" },
  { id: "ki_bonus", title: "Бонуска за ??", icon: <Star size={22} />, accent: "#4ade80" },
];

function shopIcon(title: string, kind: string): React.ReactNode {
  const s = `${title} ${kind}`.toLowerCase();
  if (s.includes("vpn") || s.includes("shield")) return <Shield size={24} />;
  if (s.includes("boost") || s.includes("буст")) return <Zap size={24} />;
  if (s.includes("gift") || s.includes("подар")) return <Gift size={24} />;
  if (s.includes("spin") || s.includes("спин") || s.includes("колес")) return <Sparkles size={24} />;
  return <ShoppingBag size={24} />;
}

const PlaceholderCard = memo(function PlaceholderCard({ item }: { item: PlaceholderItem }) {
  return (
    <div className="shop-placeholder-card">
      <div className="shop-placeholder-card__icon" style={{ color: item.accent, background: `${item.accent}18` }}>
        {item.icon}
      </div>
      <span className="shop-placeholder-card__title">{item.title}</span>
      <span className="shop-placeholder-card__badge">Скоро</span>
    </div>
  );
});

const BuyableCard = memo(function BuyableCard({
  item,
  onBuy,
}: {
  item: Item;
  onBuy: (id: string) => void;
}) {
  return (
    <div className="shop-buyable-card">
      <div className="shop-buyable-card__icon">
        {shopIcon(item.title, item.kind)}
      </div>
      <div className="shop-buyable-card__body">
        <p className="shop-buyable-card__title">{item.title}</p>
        {item.kind ? <span className="shop-buyable-card__kind">{item.kind}</span> : null}
      </div>
      <button
        type="button"
        className="primary shop-buyable-card__cta"
        onClick={() => onBuy(item.id)}
      >
        <Coins size={14} className="icon-inline-coins" aria-hidden />
        {item.priceCoins.toLocaleString("ru-RU")}
      </button>
    </div>
  );
});

export default function Shop() {
  const { patchMe, reconcileFromServer } = useMeEconomySync();
  const { activePlatform } = useActivePlatform();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [msgType, setMsgType] = useState<"ok" | "err">("ok");

  const load = useCallback(async () => {
    const r = await api<{ items: Item[] }>("/api/v1/shop/items");
    if (r.ok) {
      setItems(r.data.items);
      setMsg(null);
    } else setMsg(formatApiError(r));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const kinds = useMemo(() => {
    const k = new Set<string>();
    for (const i of items) k.add(i.kind || "Другое");
    return ["Все", ...Array.from(k).sort()];
  }, [items]);

  const [kindFilter, setKindFilter] = useState("Все");

  const filtered = useMemo(() => {
    if (kindFilter === "Все") return items;
    return items.filter((i) => (i.kind || "Другое") === kindFilter);
  }, [items, kindFilter]);

  const buy = useCallback(
    async (id: string) => {
      setMsg(null);
      const r = await api<{
        coins: number;
        coinsTwitch: number;
        coinsKick: number;
      }>("/api/v1/shop/purchase", {
        method: "POST",
        body: JSON.stringify({ itemId: id, platform: activePlatform }),
      });
      if (r.ok) {
        setMsg("Покупка оформлена");
        setMsgType("ok");
        patchMe(() => ({
          coins: r.data.coins,
          coinsTwitch: r.data.coinsTwitch,
          coinsKick: r.data.coinsKick,
        }));
        scheduleSmartRefresh(300);
        reconcileFromServer();
      } else {
        setMsg(formatApiError(r));
        setMsgType("err");
      }
    },
    [activePlatform, patchMe, reconcileFromServer]
  );

  const isTwitch = activePlatform === "twitch";
  const placeholders = isTwitch ? twitchPlaceholders : kickPlaceholders;
  const platformName = isTwitch ? "Twitch" : "Kick";
  const platformColor = isTwitch ? "#a855f7" : "#53fc18";

  return (
    <div className="shop-page">
      {loading && items.length === 0 ? (
        <PageSkeleton />
      ) : (
        <div className="shop-page__content fade-in-soft">
          {/* Header */}
          <div className="shop-header">
            <div className="shop-header__icon" style={{ color: platformColor, background: `${platformColor}18`, borderColor: `${platformColor}35` }}>
              <Tag size={22} />
            </div>
            <div>
              <h2 className="shop-header__title">Магазин</h2>
              <p className="shop-header__sub">
                Баланс {platformName} · переключатель в шапке
              </p>
            </div>
          </div>

          {msg && (
            <div className={`shop-toast ${msgType === "ok" ? "shop-toast--ok" : "shop-toast--err"}`}>
              {msg}
            </div>
          )}

          {/* Buyable items from DB */}
          {filtered.length > 0 && (
            <div className="shop-section">
              <div className="shop-section__head">
                <Sparkles size={16} className="shop-section__head-icon" />
                <span>Доступные товары</span>
              </div>
              {kinds.length > 2 && (
                <div className="filters filters--tight">
                  {kinds.map((k) => (
                    <button
                      key={k}
                      type="button"
                      className={kindFilter === k ? "on" : ""}
                      onClick={() => setKindFilter(k)}
                    >
                      {k}
                    </button>
                  ))}
                </div>
              )}
              <div className="shop-buyable-grid">
                {filtered.map((i) => (
                  <BuyableCard key={i.id} item={i} onBuy={buy} />
                ))}
              </div>
            </div>
          )}

          {/* Platform showcase */}
          <div className="shop-section">
            <div className="shop-section__head">
              <Crown size={16} className="shop-section__head-icon" />
              <span>{platformName} магазин</span>
            </div>
            <div className="shop-placeholder-grid">
              {placeholders.map((p) => (
                <PlaceholderCard key={p.id} item={p} />
              ))}
            </div>
          </div>

          {/* Assortment notice */}
          <div className="shop-notice">
            <ShoppingBag size={18} className="shop-notice__icon" />
            <span>Ассортимент магазина будет пополняться</span>
          </div>
        </div>
      )}
    </div>
  );
}
