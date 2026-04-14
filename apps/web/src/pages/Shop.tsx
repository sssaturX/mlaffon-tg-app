import { useMemo, useState } from "react";
import { ArrowRight, Coins, Package, ShoppingBag, X } from "lucide-react";
import { api, formatApiError, getToken } from "../api";
import { PageSkeleton } from "../components/PageSkeleton";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "../query/queryKeys";
import {
  fetchShopItems,
  SHOP_STALE_TIME_MS,
  type ShopItem,
} from "../query/shopQueryFns";
import { useToast } from "../context/ToastContext";
import { useActivePlatform } from "../context/PlatformContext";
import { useMeEconomySync } from "../context/MeEconomySyncContext";

export default function Shop() {
  const { activePlatform } = useActivePlatform();
  const { showToast } = useToast();
  const { patchEconomy } = useMeEconomySync();
  const { data: items, isPending, isError, refetch } = useQuery({
    queryKey: queryKeys.shop.items(activePlatform),
    queryFn: () => fetchShopItems(activePlatform),
    enabled: Boolean(getToken()),
    staleTime: SHOP_STALE_TIME_MS,
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [buying, setBuying] = useState(false);
  const [purchaseErr, setPurchaseErr] = useState<string | null>(null);
  const selected = useMemo(
    () => items?.find((row) => row.id === selectedId) ?? null,
    [items, selectedId]
  );
  const hasItems = items != null && items.length > 0;

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

  async function purchase() {
    if (!selected || buying || selected.stockRemaining === 0) return;
    setBuying(true);
    setPurchaseErr(null);
    try {
      const r = await api<{ ok: boolean }>("/api/v1/shop/purchase", {
        method: "POST",
        body: JSON.stringify({
          itemId: selected.id,
          platform: activePlatform,
        }),
      });
      if (!r.ok) {
        const msg = formatApiError(r);
        setPurchaseErr(msg);
        return;
      }
      showToast(`${selected.title} — покупка выполнена!`, "success");
      setSelectedId(null);
      void refetch();
      patchEconomy(null);
    } finally {
      setBuying(false);
    }
  }

  return (
    <div className="shop-page">
      {hasItems ? (
        <div className="shop-showcase fade-in-soft">
          {items.map((item) => {
            const meta = item.meta;
            const soldOut = item.stockRemaining === 0;
            return (
              <button
                key={item.id}
                type="button"
                className={`shop-showcase-card ${soldOut ? "shop-showcase-card--sold-out" : ""}`}
                onClick={() => {
                  setPurchaseErr(null);
                  setSelectedId(item.id);
                }}
              >
                <div className="shop-showcase-card__media">
                  {item.imageUrl ? (
                    <img
                      src={item.imageUrl}
                      alt=""
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <Package size={38} strokeWidth={1.5} />
                  )}
                  {meta?.badgeText ? (
                    <span className="shop-showcase-card__badge">{meta.badgeText}</span>
                  ) : null}
                  {item.stockRemaining != null && (
                    <span className="shop-showcase-card__stock">
                      {soldOut ? "Нет в наличии" : `${item.stockRemaining} шт.`}
                    </span>
                  )}
                </div>
                <div className="shop-showcase-card__body">
                  <p className="shop-showcase-card__title">{item.title}</p>
                  {meta?.subtitle ? (
                    <p className="shop-showcase-card__subtitle">{meta.subtitle}</p>
                  ) : item.description ? (
                    <p className="shop-showcase-card__subtitle">{item.description}</p>
                  ) : null}
                  <div className="shop-showcase-card__row">
                    <div className="shop-showcase-card__price">
                      <Coins size={14} strokeWidth={2} />
                      <span>{item.priceCoins.toLocaleString("ru-RU")}</span>
                    </div>
                    <span className="shop-showcase-card__cta">
                      {soldOut ? "Нет в наличии" : meta?.buttonLabel ?? "Открыть"}
                      <ArrowRight size={14} strokeWidth={2} />
                    </span>
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

      {selected ? (
        <div
          className="shop-popup__backdrop"
          onClick={() => {
            if (!buying) setSelectedId(null);
          }}
        >
          <div className="shop-popup" onClick={(e) => e.stopPropagation()}>
            <div className="shop-popup__head">
              <h2 className="shop-popup__title">Подтверждение покупки</h2>
              <button
                type="button"
                className="shop-popup__close"
                onClick={() => {
                  if (!buying) setSelectedId(null);
                }}
                aria-label="Закрыть"
              >
                <X size={20} />
              </button>
            </div>

            <div className="shop-popup__item">
              {selected.imageUrl ? (
                <img src={selected.imageUrl} alt="" className="shop-popup__img" />
              ) : (
                <div className="shop-popup__img shop-popup__img--ph">
                  <Package size={26} strokeWidth={1.5} />
                </div>
              )}
              <div className="shop-popup__meta">
                <p className="shop-popup__name">{selected.title}</p>
                {selected.meta?.subtitle ? (
                  <p className="shop-popup__desc">{selected.meta.subtitle}</p>
                ) : selected.description ? (
                  <p className="shop-popup__desc">{selected.description}</p>
                ) : null}
                <div className="shop-popup__price">
                  <Coins size={16} strokeWidth={2} />
                  <span>{selected.priceCoins.toLocaleString("ru-RU")}</span>
                </div>
              </div>
            </div>

            {selected.stockRemaining != null ? (
              <p className="shop-popup__stock">
                {selected.stockRemaining === 0
                  ? "Товар закончился"
                  : `Осталось в наличии: ${selected.stockRemaining}`}
              </p>
            ) : null}

            {purchaseErr ? <p className="shop-popup__err">{purchaseErr}</p> : null}

            <button
              type="button"
              className="primary shop-popup__buy"
              disabled={buying || selected.stockRemaining === 0}
              onClick={() => void purchase()}
            >
              {buying
                ? "Покупаем..."
                : `Купить за ${selected.priceCoins.toLocaleString("ru-RU")} монет`}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
