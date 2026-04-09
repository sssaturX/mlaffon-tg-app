import { appEventBus } from "../events/appEventBus";

/** Только события — без прямой записи кэша. Prefetch остаётся в вызывающем слое или отдельном listener. */
export function emitAppBootstrap(
  phase: "token_ready" | "shell_ready"
): void {
  appEventBus.emit("app:bootstrap", { phase });
}
