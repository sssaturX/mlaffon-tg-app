import { useCallback, useEffect, useMemo, useState } from "react";
import { Coins } from "lucide-react";
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

function shopEmoji(title: string, kind: string): string {
  const s = `${title} ${kind}`.toLowerCase();
  if (s.includes("vpn") || s.includes("shield")) return "🛡️";
  if (s.includes("shirt") || s.includes("футбол")) return "👕";
  if (s.includes("gift") || s.includes("подар")) return "🎁";
  if (s.includes("boost") || s.includes("буст")) return "⚡";
  return "🛒";
}

export default function Shop() {
  const { patchMe, reconcileFromServer } = useMeEconomySync();
  const { activePlatform } = useActivePlatform();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [tab, setTab] = useState<"shop" | "cases">("shop");

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

  async function buy(id: string) {
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
      setMsg(`Куплено. Баланс: ${r.data.coins.toLocaleString("ru-RU")}`);
      patchMe(() => ({
        coins: r.data.coins,
        coinsTwitch: r.data.coinsTwitch,
        coinsKick: r.data.coinsKick,
      }));
      scheduleSmartRefresh(300);
      reconcileFromServer();
    } else {
      setMsg(formatApiError(r));
    }
  }

  return (
    <div>
      <div className="segment" role="tablist" aria-label="Раздел магазина">
        <button
          type="button"
          className={tab === "shop" ? "on" : ""}
          onClick={() => setTab("shop")}
        >
          Магазин
        </button>
        <button
          type="button"
          className={tab === "cases" ? "on" : ""}
          onClick={() => setTab("cases")}
          disabled
          title="Скоро"
        >
          Кейсы
        </button>
      </div>

      {tab === "cases" ? (
        <p className="muted">Раздел «Кейсы» скоро появится.</p>
      ) : loading && items.length === 0 ? (
        <PageSkeleton />
      ) : (
        <>
          <p className="muted shop-intro">
            Оплата с баланса{" "}
            {activePlatform === "twitch" ? "Twitch" : "Kick"} (переключатель в
            шапке).
          </p>
          {msg && <p className="muted">{msg}</p>}

          {(() => {
            const featured = filtered.length > 1 ? filtered[0] : null;
            const gridItems = featured ? filtered.slice(1) : filtered;
            return (
              <>
                {featured && (
                  <div className="card shop-featured card--tint">
                    <p className="muted shop-featured__label">Рекомендуем</p>
                    <span className="shop-featured__title">{featured.title}</span>
                    <p className="muted shop-featured__kind">{featured.kind}</p>
                    <button
                      type="button"
                      className="primary btn-block"
                      onClick={() => buy(featured.id)}
                    >
                      Купить за{" "}
                      <Coins
                        size={18}
                        className="icon-inline-coins"
                        aria-hidden
                      />
                      {featured.priceCoins.toLocaleString("ru-RU")}
                    </button>
                  </div>
                )}

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

          <div className="shop-grid">
            {gridItems.map((i, idx) => (
              <div key={i.id} className="shop-card">
                <div className="shop-card__img" aria-hidden>
                  {shopEmoji(i.title, i.kind)}
                </div>
                <div className="shop-card__body">
                  <p className="shop-card__title">{i.title}</p>
                  <button
                    type="button"
                    className={
                      idx % 2 === 0
                        ? "primary shop-card__buy"
                        : "shop-card__buy shop-card__buy--blue"
                    }
                    onClick={() => buy(i.id)}
                  >
                    <Coins size={14} className="icon-inline-coins" aria-hidden />
                    {i.priceCoins.toLocaleString("ru-RU")}
                  </button>
                </div>
              </div>
            ))}
          </div>
              </>
            );
          })()}
        </>
      )}
    </div>
  );
}
