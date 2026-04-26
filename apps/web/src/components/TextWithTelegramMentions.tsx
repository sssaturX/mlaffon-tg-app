import { TelegramWebApp as WebApp } from "../lib/telegramAdapter";

function splitTelegramMentions(text: string): { t: "text" | "mention"; v: string }[] {
  const re = /@([a-zA-Z][a-zA-Z0-9_]{3,32})/g;
  const out: { t: "text" | "mention"; v: string }[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ t: "text", v: text.slice(last, m.index) });
    out.push({ t: "mention", v: m[1]! });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ t: "text", v: text.slice(last) });
  return out;
}

function openTelegramHref(href: string) {
  try {
    WebApp.openLink(href);
  } catch {
    window.open(href, "_blank", "noopener,noreferrer");
  }
}

export function TextWithTelegramMentions({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const chunks = splitTelegramMentions(text);
  return (
    <span className={className}>
      {chunks.map((c, i) => {
        if (c.t === "mention") {
          const href = `https://t.me/${c.v}`;
          return (
            <a
              key={i}
              href={href}
              className="shop-mention-link"
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => {
                e.preventDefault();
                openTelegramHref(href);
              }}
            >
              @{c.v}
            </a>
          );
        }
        return <span key={i}>{c.v}</span>;
      })}
    </span>
  );
}
