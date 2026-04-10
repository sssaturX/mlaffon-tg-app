import type { TaskEvidenceExample, TaskHelpHint, TaskHelpIcon } from "shared";

const HELP_ICONS: TaskHelpIcon[] = ["tv", "gift", "help", "radio"];

function isHelpIcon(v: unknown): v is TaskHelpIcon {
  return typeof v === "string" && HELP_ICONS.includes(v as TaskHelpIcon);
}

export function extractTaskUiFields(meta: Record<string, unknown> | null): {
  actionUrl: string | null;
  actionLabel: string | null;
  verifyLabel: string | null;
  help: TaskHelpHint | null;
} {
  if (!meta) {
    return {
      actionUrl: null,
      actionLabel: null,
      verifyLabel: null,
      help: null,
    };
  }
  const actionUrl = typeof meta.actionUrl === "string" ? meta.actionUrl : null;
  const actionLabel = typeof meta.actionLabel === "string" ? meta.actionLabel : null;
  const verifyLabel = typeof meta.verifyLabel === "string" ? meta.verifyLabel : null;
  let help: TaskHelpHint | null = null;
  const raw = meta.help;
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (typeof o.title === "string" && typeof o.body === "string") {
      help = {
        title: o.title,
        body: o.body,
        ...(isHelpIcon(o.icon) ? { icon: o.icon } : {}),
      };
    }
  }
  return { actionUrl, actionLabel, verifyLabel, help };
}

export function extractEvidenceExamples(
  meta: Record<string, unknown> | null
): TaskEvidenceExample[] | undefined {
  if (!meta || !Array.isArray(meta.evidenceExamples)) return undefined;
  const out: TaskEvidenceExample[] = [];
  for (const item of meta.evidenceExamples) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const src = typeof o.src === "string" ? o.src.trim() : "";
    if (!src) continue;
    const caption =
      typeof o.caption === "string" && o.caption.trim() ? o.caption.trim() : undefined;
    out.push(caption ? { src, caption } : { src });
  }
  return out.length ? out : undefined;
}
