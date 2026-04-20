import { memo, useCallback } from "react";
import { ArrowRight, Coins, Package } from "lucide-react";
import type { ImgHTMLAttributes } from "react";
import { ResponsivePicture } from "../ResponsivePicture";
import type { ShopItem } from "../../query/shopQueryFns";

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
  const priorityImage = index < 2 && Boolean(item.imageUrl || item.imageMedia);
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
        {item.imageMedia ? (
          <ResponsivePicture
            image={item.imageMedia}
            alt=""
            sizes="(max-width: 640px) 50vw, 240px"
            hero={priorityImage}
            layout="fill"
          />
        ) : item.imageUrl ? (
          <img
            src={item.imageUrl}
            alt=""
            loading={priorityImage ? "eager" : "lazy"}
            decoding="async"
            {...(priorityImage
              ? ({ fetchPriority: "high" } as ImgHTMLAttributes<HTMLImageElement>)
              : {})}
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
