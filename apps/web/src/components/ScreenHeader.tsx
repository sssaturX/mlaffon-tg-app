import { Coins } from "lucide-react";
import { useActivePlatform } from "../context/PlatformContext";
import { useAnimatedNumber } from "../hooks/useAnimatedNumber";

export function ScreenHeader({
  title,
  balance,
}: {
  title: string;
  balance: number | null;
}) {
  const { activePlatform, setActivePlatform } = useActivePlatform();
  const animatedBalance = useAnimatedNumber(balance);

  return (
    <header className="screen-header">
      <h1 className="screen-header__title">{title}</h1>
      <div className="screen-header__controls">
        <div
          className="platform-toggle"
          data-tour-target="platform-toggle"
          role="group"
          aria-label="Платформа"
        >
          <button
            type="button"
            className={activePlatform === "twitch" ? "on" : ""}
            onClick={() => setActivePlatform("twitch")}
          >
            Twitch
          </button>
          <button
            type="button"
            className={activePlatform === "kick" ? "on" : ""}
            onClick={() => setActivePlatform("kick")}
          >
            Kick
          </button>
        </div>
        {balance != null && animatedBalance != null && (
          <div className="balance-pill" aria-label="Баланс выбранной платформы">
            <Coins className="balance-pill__icon" size={18} strokeWidth={2.2} />
            <span>{animatedBalance.toLocaleString("ru-RU")}</span>
          </div>
        )}
      </div>
    </header>
  );
}

export function routeTitle(pathname: string): string {
  if (pathname === "/") return "Главная";
  if (pathname.startsWith("/tasks")) return "Задания";
  if (pathname.startsWith("/games")) return "Игры";
  if (pathname.startsWith("/shop")) return "Магазин";
  if (pathname.startsWith("/leaderboard")) return "Топ";
  if (pathname.startsWith("/profile")) return "Профиль";
  if (pathname.startsWith("/oauth")) return "Подключение";
  if (pathname === "/giveaways") return "Розыгрыши";
  if (pathname.startsWith("/giveaway/")) return "Розыгрыш";
  return "Mlaffon";
}
