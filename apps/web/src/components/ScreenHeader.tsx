import { Coins } from "lucide-react";

export function ScreenHeader({
  title,
  balance,
}: {
  title: string;
  balance: number | null;
}) {
  return (
    <header className="screen-header">
      <h1 className="screen-header__title">{title}</h1>
      {balance != null && (
        <div className="balance-pill" aria-label="Баланс">
          <Coins className="balance-pill__icon" size={18} strokeWidth={2.2} />
          <span>{balance.toLocaleString("ru-RU")}</span>
        </div>
      )}
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
  return "Mlaffon";
}
