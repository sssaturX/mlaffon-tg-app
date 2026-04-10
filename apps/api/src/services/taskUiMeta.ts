import type {
  TaskEvidenceExampleItem,
  TaskEvidenceExamples,
  TaskHelpHint,
  TaskHelpIcon,
} from "shared";

const HELP_ICONS: TaskHelpIcon[] = ["tv", "gift", "help", "radio"];

function isHelpIcon(v: unknown): v is TaskHelpIcon {
  return typeof v === "string" && HELP_ICONS.includes(v as TaskHelpIcon);
}

function parseEvidenceExamples(
  raw: unknown
): TaskEvidenceExamples | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const title =
    typeof o.title === "string" && o.title.trim()
      ? o.title.trim()
      : "Примеры скриншотов";
  const arr = o.items;
  if (!Array.isArray(arr)) return null;
  const items: TaskEvidenceExampleItem[] = [];
  for (const it of arr) {
    if (!it || typeof it !== "object") continue;
    const r = it as Record<string, unknown>;
    const imageUrl =
      typeof r.imageUrl === "string" && r.imageUrl.trim()
        ? r.imageUrl.trim()
        : null;
    if (!imageUrl) continue;
    const label =
      typeof r.label === "string" && r.label.trim()
        ? r.label.trim()
        : undefined;
    items.push(label ? { label, imageUrl } : { imageUrl });
  }
  return items.length > 0 ? { title, items } : null;
}

export function extractTaskUiFields(meta: Record<string, unknown> | null): {
  actionUrl: string | null;
  actionLabel: string | null;
  verifyLabel: string | null;
  help: TaskHelpHint | null;
  evidenceExamples: TaskEvidenceExamples | null;
} {
  if (!meta) {
    return {
      actionUrl: null,
      actionLabel: null,
      verifyLabel: null,
      help: null,
      evidenceExamples: null,
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
  const evidenceExamples = parseEvidenceExamples(meta.evidenceExamples);
  return { actionUrl, actionLabel, verifyLabel, help, evidenceExamples };
}
