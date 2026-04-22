import { resolveAdminImageForPreview, type MediaImageUploadResponse } from "shared";
import { ResolvedMediaImage } from "../ResolvedMediaImage";

export type GiveawayCardMediaProps = {
  imageUrl: string | null | undefined;
  imageMedia?: MediaImageUploadResponse | null | undefined;
};

const CARD_SIZES = "(max-width: 640px) 50vw, 280px";

export function GiveawayCardMedia({ imageUrl, imageMedia }: GiveawayCardMediaProps) {
  const resolved = resolveAdminImageForPreview(imageUrl ?? null, imageMedia ?? null);
  if (!resolved) {
    return <div className="giveaway-card__placeholder" aria-hidden />;
  }
  if (resolved.mode === "responsive") {
    return (
      <div className="giveaway-card__picture-wrap">
        <ResolvedMediaImage
          resolved={resolved}
          alt=""
          sizes={CARD_SIZES}
          layout="fill"
        />
      </div>
    );
  }
  return (
    <ResolvedMediaImage
      resolved={resolved}
      alt=""
      sizes={CARD_SIZES}
      layout="intrinsic"
      directImgClassName="giveaway-card__img"
    />
  );
}
