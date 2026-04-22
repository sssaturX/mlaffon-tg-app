import { memo, useCallback } from "react";
import { ArrowRight, Coins, Package } from "lucide-react";
import { resolveAdminImageForPreview } from "shared";
import type { ShopItem } from "../../query/shopQueryFns";
import { ShopItemImage } from "./ShopItemImage";

export type ShopShowcaseItemProps = {
  item: ShopItem;
  index: number;
  onSelect: (id: string) => void;
};

function ShopShowcaseItemInner({
  item,
  index,
  onSelect,
}: ShopShowcaseItemProps) {
  const meta = item.meta;
  const soldOut = item.stockRemaining === 0;
  const imageResolved = resolveAdminImageForPreview(item.imageUrl, item.imageMedia);
  const priorityImage = index < 2 && imageResolved != null;
  const onClick = useCallback(() => {
    onSelect(item.id);
  }, [onSelect, item.id]);

  return (
    <button
      type="button"
      className={`shop-showcase-card ${soldOut ? "shop-showcase-card--sold-out" : ""}`}
      onClick={onClick}
    >
      <div className="shop-showcase-card__media">
        {imageResolved ? (
          <ShopItemImage
            resolved={imageResolved}
            alt=""
            sizes="(max-width: 640px) 50vw, 240px"
            hero={priorityImage}
            layout="fill"
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
}

export const ShopShowcaseItem = memo(ShopShowcaseItemInner);
