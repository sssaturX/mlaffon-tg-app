import { createEventBus } from "./eventBus";
import type { AppEventMap } from "./appEvents";

export const appEventBus = createEventBus<AppEventMap>();
