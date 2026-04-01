import { Coins } from "lucide-react";
import { useActivePlatform } from "../context/PlatformContext";
import { useAnimatedNumber } from "../hooks/useAnimatedNumber";
import { useLiveBroadcastStore } from "../store/liveBroadcastStore";

/** key только по платформе — число анимируется внутри; при key=баланс при каждом тике ломалась анимация и WS-обновления. */
function BalanceWithAnimation({ value }: { value: number }) {
  const animated = useAnimatedNumber(value);
  if (animated == null) return null;
  return <span>{animated.toLocaleString("ru-RU")}</span>;
}

export function ScreenHeader({
  title,
  balance,
}: {
  title: string;
  balance: number | null;
}) {
  const { activePlatform, setActivePlatform } = useActivePlatform();
  const broadcast = useLiveBroadcastStore((s) => s.broadcast);
  const liveLocks =
    broadcast?.active === true ? broadcast.platform : null;

  const lockHint =
    liveLocks === "twitch"
      ? "Сейчас эфир на Twitch — переключение недоступно"
      : liveLocks === "kick"
        ? "Сейчас эфир на Kick — переключение недоступно"
        : undefined;

  return (
    <header className="screen-header">
      <h1 className="screen-header__title">{title}</h1>
      <div className="screen-header__controls">
        <div
          className="platform-toggle"
          data-tour-target="platform-toggle"
          role="group"
          aria-label="Платформа"
          title={lockHint}
        >
          <button
            type="button"
            className={activePlatform === "twitch" ? "on" : ""}
            disabled={liveLocks != null && liveLocks !== "twitch"}
            title={
              liveLocks != null && liveLocks !== "twitch"
                ? lockHint
                : undefined
            }
            onClick={() => setActivePlatform("twitch")}
          >
            Twitch
          </button>
          <button
            type="button"
            className={activePlatform === "kick" ? "on" : ""}
            disabled={liveLocks != null && liveLocks !== "kick"}
            title={
              liveLocks != null && liveLocks !== "kick"
                ? lockHint
                : undefined
            }
            onClick={() => setActivePlatform("kick")}
          >
            Kick
          </button>
        </div>
        {balance != null && (
          <div className="balance-pill" aria-label="Баланс выбранной платформы">
            <Coins className="balance-pill__icon" size={18} strokeWidth={2.2} />
            <BalanceWithAnimation
              key={activePlatform}
              value={balance}
            />
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
