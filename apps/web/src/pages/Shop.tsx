import { memo, useCallback, useEffect, useState } from "react";
import { ShoppingBag, Sparkles } from "lucide-react";
import { useActivePlatform } from "../context/PlatformContext";
import { api, formatApiError } from "../api";
import { useToast } from "../context/ToastContext";
import { useMeEconomySync } from "../context/MeEconomySyncContext";

type ShopItemRow = {
  id: string;
  title: string;
  kind: string;
  priceCoins: number;
  meta: Record<string, unknown> | null;
};

function itemPlatform(meta: Record<string, unknown> | null): string | null {
  const p = meta?.platform;
  return typeof p === "string" ? p : null;
}

const ShopItemCard = memo(function ShopItemCard({
  item,
  busy,
  onBuy,
}: {
  item: ShopItemRow;
  busy: boolean;
  onBuy: (id: string) => void;
}) {
  const note =
    typeof item.meta?.fulfillmentNote === "string"
      ? item.meta.fulfillmentNote
      : null;
  return (
    <div className="shop-item-card">
      <div className="shop-item-card__body">
        <h3 className="shop-item-card__title">{item.title}</h3>
        {note ? <p className="muted text-caption m-0">{note}</p> : null}
        <p className="shop-item-card__price">
          {item.priceCoins.toLocaleString("ru-RU")}{" "}
          <span className="muted">монет</span>
        </p>
      </div>
      <button
        type="button"
        className="primary shop-item-card__btn"
        disabled={busy}
        onClick={() => onBuy(item.id)}
      >
        Купить
      </button>
    </div>
  );
});

export default function Shop() {
  const { activePlatform } = useActivePlatform();
  const { showToast } = useToast();
  const { patchMe } = useMeEconomySync();
  const [items, setItems] = useState<ShopItemRow[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [purchasingId, setPurchasingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await api<{ items: ShopItemRow[] }>("/api/v1/shop/items");
    if (r.ok) {
      setItems(r.data.items);
      setLoadErr(null);
    } else {
      setLoadErr(formatApiError(r));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible =
    items?.filter((it) => {
      const p = itemPlatform(it.meta);
      if (!p) return true;
      return p === activePlatform;
    }) ?? [];

  const platformName = activePlatform === "twitch" ? "Twitch" : "Kick";

  async function buy(itemId: string) {
    setPurchasingId(itemId);
    try {
      const r = await api<{
        coins: number;
        coinsTwitch: number;
        coinsKick: number;
      }>("/api/v1/shop/purchase", {
        method: "POST",
        body: JSON.stringify({ itemId, platform: activePlatform }),
      });
      if (!r.ok) {
        showToast(formatApiError(r), "error");
        return;
      }
      patchMe(() => ({
        coins: r.data.coins,
        coinsTwitch: r.data.coinsTwitch,
        coinsKick: r.data.coinsKick,
      }));
      showToast("Покупка оформлена — поддержка свяжется для выдачи, если нужно", "success", {
        durationMs: 5000,
      });
      void load();
    } finally {
      setPurchasingId(null);
    }
  }

  return (
    <div className="shop-page">
      <div className="shop-page__content fade-in-soft">
        <div className="shop-section">
          <div className="shop-section__head">
            <Sparkles size={16} className="shop-section__head-icon" />
            <span>Магазин · {platformName}</span>
          </div>
          {loadErr ? (
            <p className="err">{loadErr}</p>
          ) : items === null ? (
            <p className="muted">Загрузка…</p>
          ) : visible.length === 0 ? (
            <p className="muted">Для этой платформы пока нет товаров.</p>
          ) : (
            <div className="shop-items-grid">
              {visible.map((it) => (
                <ShopItemCard
                  key={it.id}
                  item={it}
                  busy={purchasingId === it.id}
                  onBuy={(id) => void buy(id)}
                />
              ))}
            </div>
          )}
        </div>

        <div className="shop-notice">
          <ShoppingBag size={18} className="shop-notice__icon" />
          <span>
            VIP, батлпасс и Steam — оплата монетами в приложении; активация призов может быть
            вручную через поддержку.
          </span>
        </div>
      </div>
    </div>
  );
}
