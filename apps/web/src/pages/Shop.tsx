import { useCallback, useEffect, useMemo, useState } from "react";
import { Coins, Package, ShoppingBag, X } from "lucide-react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api, formatApiError, getToken } from "../api";
import { TextWithTelegramMentions } from "../components/TextWithTelegramMentions";
import { ResponsivePicture } from "../components/ResponsivePicture";
import { ShopShowcaseItem } from "../components/shop/ShopShowcaseItem";
import { queryKeys } from "../query/queryKeys";
import {
  fetchShopPage,
  SHOP_GC_TIME_MS,
  SHOP_STALE_TIME_MS,
} from "../query/shopQueryFns";
import { useToast } from "../context/ToastContext";
import { useActivePlatform } from "../context/PlatformContext";
import { useMeEconomySync } from "../context/MeEconomySyncContext";
import { getMeFromCache } from "../hooks/queries/useMergedMe";

function ShopShowcaseSkeleton() {
  return (
    <div className="shop-page">
      <div
        className="shop-showcase shop-showcase--skeleton"
        aria-busy="true"
        aria-label="Загрузка магазина"
      >
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="shop-showcase-card shop-showcase-card--skeleton"
            aria-hidden
          >
            <div className="shop-showcase-card__media">
              <div className="skeleton skeleton--shop-media" />
            </div>
            <div className="shop-showcase-card__body">
              <div className="skeleton skeleton--shop-title" />
              <div className="skeleton skeleton--shop-line" />
              <div className="skeleton skeleton--shop-row" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Shop() {
  const { activePlatform } = useActivePlatform();
  const { showToast } = useToast();
  const { patchEconomy } = useMeEconomySync();
  const { data: shopData, isError, refetch, isFetching, isPlaceholderData } =
    useQuery({
      queryKey: queryKeys.shop.items(activePlatform),
      queryFn: () => fetchShopPage(activePlatform),
      enabled: Boolean(getToken()),
      staleTime: SHOP_STALE_TIME_MS,
      gcTime: SHOP_GC_TIME_MS,
      placeholderData: keepPreviousData,
    });
  const items = shopData?.items ?? [];
  const globalCopy = shopData?.globalCopy;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [buying, setBuying] = useState(false);
  const [purchaseErr, setPurchaseErr] = useState<string | null>(null);

  const onSelectItem = useCallback((id: string) => {
    setPurchaseErr(null);
    setSelectedId(id);
  }, []);

  useEffect(() => {
    setSelectedId(null);
    setPurchaseErr(null);
  }, [activePlatform]);

  useEffect(() => {
    const url = items[0]?.imageUrl;
    if (!url) return;
    const link = document.createElement("link");
    link.rel = "preload";
    link.as = "image";
    link.href = url;
    link.setAttribute("fetchpriority", "high");
    document.head.appendChild(link);
    return () => {
      link.remove();
    };
  }, [items]);

  const selected = useMemo(
    () => items.find((row) => row.id === selectedId) ?? null,
    [items, selectedId]
  );

  const me = getMeFromCache();
  const platformCoins =
    activePlatform === "twitch" ? (me?.coinsTwitch ?? 0) : (me?.coinsKick ?? 0);
  const coinsKnown = me != null;
  const coinsShort =
    coinsKnown && selected && selected.stockRemaining !== 0
      ? Math.max(0, selected.priceCoins - platformCoins)
      : 0;
  const cantAfford = coinsShort > 0;

  /** Ошибка без кэша, или ошибка после смены платформы (нельзя показывать placeholder от другой платформы). */
  if (isError && (!shopData || isPlaceholderData)) {
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

  if (!shopData) {
    return <ShopShowcaseSkeleton />;
  }

  const hasItems = items.length > 0;

  async function purchase() {
    if (!selected || buying || selected.stockRemaining === 0 || cantAfford) return;
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
        <div
          className={`shop-showcase fade-in-soft${
            isFetching && isPlaceholderData ? " shop-showcase--platform-switch" : ""
          }`}
        >
          {items.map((item, index) => (
            <ShopShowcaseItem
              key={item.id}
              item={item}
              index={index}
              onSelect={onSelectItem}
            />
          ))}
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
              {selected.imageMedia ? (
                <ResponsivePicture
                  image={selected.imageMedia}
                  alt=""
                  sizes="72px"
                  layout="fill"
                  className="shop-popup__img--picture"
                />
              ) : selected.imageUrl ? (
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

            {globalCopy?.notice ? (
              <p className="shop-popup__notice">
                <TextWithTelegramMentions text={globalCopy.notice} />
              </p>
            ) : null}

            {globalCopy?.warning ? (
              <div className="shop-popup__warning" role="note">
                <TextWithTelegramMentions text={globalCopy.warning} />
              </div>
            ) : null}

            {cantAfford ? (
              <p className="shop-popup__insufficient">
                Недостаточно монет. Нужно ещё {coinsShort.toLocaleString("ru-RU")}
              </p>
            ) : null}

            {purchaseErr ? <p className="shop-popup__err">{purchaseErr}</p> : null}

            <button
              type="button"
              className="primary shop-popup__buy"
              disabled={buying || selected.stockRemaining === 0 || cantAfford}
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
