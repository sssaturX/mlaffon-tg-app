import { useEffect, useMemo, useState } from "react";
import { ChevronRight, Coins, Lightbulb, Package, ShoppingBag, X } from "lucide-react";
import { api, formatApiError, getToken } from "../api";
import { PageSkeleton } from "../components/PageSkeleton";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "../query/queryKeys";
import {
  fetchShopItems,
  SHOP_STALE_TIME_MS,
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
  const selectedDescription = useMemo(() => {
    if (!selected) return "";
    return (
      selected.description?.trim() ||
      selected.meta?.subtitle?.trim() ||
      "Описание товара пока не добавлено."
    );
  }, [selected]);
  const hasItems = items != null && items.length > 0;

  useEffect(() => {
    if (!selected) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !buying) setSelectedId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [selected, buying]);

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
      <div className="task-hint task-hint--stream" role="note">
        <Lightbulb size={20} className="task-hint__icon" aria-hidden />
        <span>
          Нажми на карточку товара — откроется подробное описание и кнопка покупки в
          едином стиле с заданиями.
        </span>
      </div>
      {hasItems ? (
        <div className="stack task-stack">
          {items.map((item) => {
            const meta = item.meta;
            const soldOut = item.stockRemaining === 0;
            const snippet =
              meta?.subtitle?.trim() ||
              item.description?.trim() ||
              "Откройте карточку товара для полного описания.";
            return (
              <article
                key={item.id}
                className={`task-card-preview fade-in-soft ${soldOut ? "task-card-preview--done" : ""}`}
              >
                <button
                  type="button"
                  className="task-card-preview__main"
                  onClick={() => {
                    setPurchaseErr(null);
                    setSelectedId(item.id);
                  }}
                >
                  <div className="task-card-preview__row">
                    <div className="task-card-preview__tags">
                      <span className="pill pill--task-project">Товар</span>
                      {meta?.badgeText ? (
                        <span className="pill pill--accent pill--compact">{meta.badgeText}</span>
                      ) : null}
                      <span className="pill pill--compact">
                        {item.stockRemaining == null
                          ? "Без лимита"
                          : soldOut
                            ? "Нет в наличии"
                            : `Осталось ${item.stockRemaining}`}
                      </span>
                    </div>
                    <div className="task-card-preview__reward">
                      <Coins size={18} strokeWidth={2.2} aria-hidden />
                      <span>{item.priceCoins.toLocaleString("ru-RU")}</span>
                    </div>
                  </div>
                  <h3 className="task-card-preview__title">{item.title}</h3>
                  <p className="task-card-preview__snippet">{snippet}</p>
                  <div className="task-card-preview__footer">
                    <span className="task-card-preview__hint muted">
                      {soldOut ? "Товар закончился" : meta?.buttonLabel ?? "Открыть товар"}
                    </span>
                    <ChevronRight
                      className="task-card-preview__arrow"
                      size={20}
                      strokeWidth={2}
                      aria-hidden
                    />
                  </div>
                </button>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="card text-center fade-in-soft shop-empty">
          <ShoppingBag size={40} strokeWidth={1.5} className="shop-empty__icon" aria-hidden />
          <p className="empty-state__title mb-2">Магазин пока пуст</p>
          <p className="muted m-0">Товары скоро появятся. Загляните чуть позже.</p>
        </div>
      )}

      {selected ? (
        <div
          className="task-detail-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="shop-detail-title"
          onClick={() => {
            if (!buying) setSelectedId(null);
          }}
        >
          <div className="task-detail-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="task-detail-sheet__handle" aria-hidden />
            <div className="task-detail-modal task-detail-modal--sheet">
              <div className="task-detail-modal__head">
                <h2 id="shop-detail-title" className="task-detail-modal__title">
                  {selected.title}
                </h2>
                <button
                  type="button"
                  className="task-detail-modal__close"
                  onClick={() => {
                    if (!buying) setSelectedId(null);
                  }}
                  aria-label="Закрыть"
                >
                  <X size={20} strokeWidth={2.2} />
                </button>
              </div>

              <div className="task-detail-modal__body">
                <div className="shop-task-detail__media task-detail-modal__block">
                  {selected.imageUrl ? (
                    <img
                      src={selected.imageUrl}
                      alt=""
                      className="shop-task-detail__img"
                      loading="lazy"
                      decoding="async"
                    />
                  ) : (
                    <div className="shop-task-detail__img shop-task-detail__img--ph">
                      <Package size={28} strokeWidth={1.6} />
                    </div>
                  )}
                </div>

                <div className="task-detail-modal__desc">
                  {selectedDescription.split("\n").map((line, i) => (
                    <p key={i} className="task-detail-modal__desc-line">
                      {line}
                    </p>
                  ))}
                </div>

                <div className="task-detail-reward">
                  <span className="task-detail-reward__label">Цена:</span>
                  <span className="task-detail-reward__value">
                    <Coins
                      size={22}
                      strokeWidth={2.2}
                      className="task-detail-reward__coin"
                      aria-hidden
                    />
                    {selected.priceCoins.toLocaleString("ru-RU")}
                  </span>
                </div>

                {selected.stockRemaining != null ? (
                  <p className="task-detail-link-hint muted">
                    {selected.stockRemaining === 0
                      ? "Товар закончился."
                      : `Осталось в наличии: ${selected.stockRemaining}`}
                  </p>
                ) : null}

                {purchaseErr ? (
                  <p className="task-detail-modal__msg err">{purchaseErr}</p>
                ) : null}

                <div className="task-detail-modal__actions">
                  <button
                    type="button"
                    className={`task-detail-btn task-detail-btn--primary ${selected.stockRemaining !== 0 ? "task-detail-btn--primary--prominent" : ""}`}
                    disabled={buying || selected.stockRemaining === 0}
                    onClick={() => void purchase()}
                  >
                    {buying
                      ? "Покупаем..."
                      : `Купить за ${selected.priceCoins.toLocaleString("ru-RU")} монет`}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
