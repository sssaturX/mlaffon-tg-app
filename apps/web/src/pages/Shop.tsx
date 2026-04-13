import { useCallback, useState } from "react";
import { Coins, Package, ShoppingBag, X } from "lucide-react";
import { api, formatApiError, getToken } from "../api";
import { useToast } from "../context/ToastContext";
import { useActivePlatform } from "../context/PlatformContext";
import { useMeEconomySync } from "../context/MeEconomySyncContext";
import { PageSkeleton } from "../components/PageSkeleton";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "../query/queryKeys";

type ShopItem = {
  id: string;
  title: string;
  description: string | null;
  imageUrl: string | null;
  kind: string;
  priceCoins: number;
  meta: unknown;
  stockRemaining: number | null;
};

const STALE_SHOP = 1000 * 60 * 2;

async function fetchShopItems(): Promise<ShopItem[]> {
  const r = await api<{ items: ShopItem[] }>("/api/v1/shop/items", {
    httpCache: "default",
  });
  if (!r.ok) throw new Error("shop_load");
  return r.data.items;
}

export default function Shop() {
  const { activePlatform } = useActivePlatform();
  const { showToast } = useToast();
  const { patchEconomy } = useMeEconomySync();

  const { data: items, isPending, isError, refetch } = useQuery({
    queryKey: queryKeys.shop.items(),
    queryFn: fetchShopItems,
    enabled: Boolean(getToken()),
    staleTime: STALE_SHOP,
  });

  const [selected, setSelected] = useState<ShopItem | null>(null);
  const [buying, setBuying] = useState(false);

  const close = useCallback(() => {
    if (!buying) setSelected(null);
  }, [buying]);

  async function purchase() {
    if (!selected || buying) return;
    setBuying(true);
    try {
      const r = await api<{ ok: boolean }>("/api/v1/shop/purchase", {
        method: "POST",
        body: JSON.stringify({
          itemId: selected.id,
          platform: activePlatform,
        }),
      });
      if (!r.ok) {
        showToast(formatApiError(r), "error");
        return;
      }
      showToast(`${selected.title} — покупка выполнена!`, "success");
      setSelected(null);
      void refetch();
      patchEconomy(null);
    } finally {
      setBuying(false);
    }
  }

  if (isPending) return <PageSkeleton />;

  if (isError) {
    return (
      <div className="shop-page">
        <div className="card stack">
          <p className="err">Не удалось загрузить магазин.</p>
          <button type="button" className="primary" onClick={() => void refetch()}>
            Повторить
          </button>
        </div>
      </div>
    );
  }

  const hasItems = items && items.length > 0;

  return (
    <div className="shop-page">
      {hasItems ? (
        <div className="shop-grid fade-in-soft">
          {items.map((item) => {
            const soldOut = item.stockRemaining === 0;
            return (
              <button
                key={item.id}
                type="button"
                className={`shop-card ${soldOut ? "shop-card--sold-out" : ""}`}
                onClick={() => !soldOut && setSelected(item)}
                disabled={soldOut}
              >
                <div className="shop-card__img">
                  {item.imageUrl ? (
                    <img
                      src={item.imageUrl}
                      alt=""
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <Package size={36} strokeWidth={1.5} />
                  )}
                  {item.stockRemaining != null && (
                    <span className="shop-card__stock">
                      {soldOut ? "Нет в наличии" : `${item.stockRemaining} шт.`}
                    </span>
                  )}
                </div>
                <div className="shop-card__body">
                  <p className="shop-card__title">{item.title}</p>
                  <div className="shop-card__price">
                    <Coins size={14} strokeWidth={2} />
                    <span>{item.priceCoins.toLocaleString("ru-RU")}</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="shop-empty fade-in-soft">
          <ShoppingBag size={40} strokeWidth={1.5} className="shop-empty__icon" />
          <p>Магазин пока пуст — товары скоро появятся</p>
        </div>
      )}

      {selected && (
        <div className="shop-modal__backdrop" onClick={close}>
          <div className="shop-modal" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="shop-modal__close"
              onClick={close}
              aria-label="Закрыть"
            >
              <X size={20} />
            </button>

            <h2 className="shop-modal__heading">Подтверждение покупки</h2>

            <div className="shop-modal__item">
              {selected.imageUrl ? (
                <img
                  src={selected.imageUrl}
                  alt=""
                  className="shop-modal__img"
                />
              ) : (
                <div className="shop-modal__img shop-modal__img--ph">
                  <Package size={28} strokeWidth={1.5} />
                </div>
              )}
              <div className="shop-modal__meta">
                <p className="shop-modal__title">{selected.title}</p>
                {selected.description && (
                  <p className="shop-modal__desc muted">{selected.description}</p>
                )}
                {selected.stockRemaining != null && (
                  <p className="shop-modal__stock muted">
                    В наличии: {selected.stockRemaining}
                  </p>
                )}
              </div>
            </div>

            <div className="shop-modal__price-row">
              <Coins size={18} strokeWidth={2} />
              <span>{selected.priceCoins.toLocaleString("ru-RU")}</span>
            </div>

            <button
              type="button"
              className="primary shop-modal__buy"
              disabled={buying || selected.stockRemaining === 0}
              onClick={() => void purchase()}
            >
              {buying
                ? "..."
                : `Купить за ${selected.priceCoins.toLocaleString("ru-RU")} монет`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
