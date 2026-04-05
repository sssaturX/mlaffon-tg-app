import { memo } from "react";
import { Crown, Gamepad2, Shield, Gift, Star, ShoppingBag, Sparkles } from "lucide-react";
import { useActivePlatform } from "../context/PlatformContext";

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

export default function Shop() {
  const { activePlatform } = useActivePlatform();

  const isTwitch = activePlatform === "twitch";
  const placeholders = isTwitch ? twitchPlaceholders : kickPlaceholders;
  const platformName = isTwitch ? "Twitch" : "Kick";

  return (
    <div className="shop-page">
      <div className="shop-page__content fade-in-soft">
        {/* Platform showcase */}
        <div className="shop-section">
          <div className="shop-section__head">
            <Sparkles size={16} className="shop-section__head-icon" />
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
    </div>
  );
}
