import { useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Platform, TaskDto } from "shared";
import { TaskCardPreview } from "./TaskCardPreview";

export type TaskFeedRow =
  | { kind: "section"; section: string }
  | { kind: "task"; section: string; task: TaskDto };

const EST_SECTION = 52;
const EST_TASK = 188;

/** Ниже порога — обычный map (мало DOM); выше — окно + виртуализация. */
export const TASK_FEED_VIRTUAL_THRESHOLD = 12;

function sectionHeading(section: string, activePlatform: Platform): string {
  if (section === "black_russia") return "BLACK RUSSIA";
  if (section === "stream_tasks")
    return activePlatform === "kick" ? "KICK" : "TWITCH";
  if (section === "telegram") return "TELEGRAM";
  if (section === "global") return "ОБЩЕЕ";
  return "ЗАДАНИЯ";
}

function sectionHeadingClass(section: string, activePlatform: Platform): string {
  if (section !== "stream_tasks") return "";
  return activePlatform === "kick"
    ? "task-stream__heading--kick"
    : "task-stream__heading--twitch";
}

type CommonProps = {
  sectionKeys: string[];
  grouped: Map<string, TaskDto[]>;
  activePlatform: Platform;
  onOpenDetail: (task: TaskDto) => void;
  onOpenHelp: (task: TaskDto) => void;
};

function TaskFeedStatic({
  sectionKeys,
  grouped,
  activePlatform,
  onOpenDetail,
  onOpenHelp,
}: CommonProps) {
  return (
    <div className="task-stream">
      {sectionKeys.map((section) => (
        <section key={section} className="task-stream__section">
          <h2
            className={`task-stream__heading ${sectionHeadingClass(section, activePlatform)}`}
          >
            {sectionHeading(section, activePlatform)}
          </h2>
          <div className="stack task-stack">
            {(grouped.get(section) ?? []).map((t) => (
              <TaskCardPreview
                key={t.id}
                t={t}
                section={section}
                activePlatform={activePlatform}
                onOpenDetail={onOpenDetail}
                onOpenHelp={onOpenHelp}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function TaskFeedWindowVirtual({
  sectionKeys,
  grouped,
  activePlatform,
  onOpenDetail,
  onOpenHelp,
}: CommonProps) {
  const flatRows = useMemo((): TaskFeedRow[] => {
    const rows: TaskFeedRow[] = [];
    for (const section of sectionKeys) {
      rows.push({ kind: "section", section });
      for (const t of grouped.get(section) ?? []) {
        rows.push({ kind: "task", section, task: t });
      }
    }
    return rows;
  }, [sectionKeys, grouped]);

  /** Скролл внутри области ленты — без useWindowVirtualizer/scrollMargin (они давали ложный зазор под подсказкой). */
  const scrollParentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: (index) => {
      const r = flatRows[index];
      return r?.kind === "section" ? EST_SECTION : EST_TASK;
    },
    overscan: 6,
  });

  const totalSize = virtualizer.getTotalSize();
  const items = virtualizer.getVirtualItems();

  return (
    <div
      className="task-stream task-stream--virtual tasks-feed-scroll"
      ref={scrollParentRef}
    >
      <div
        style={{
          height: totalSize,
          width: "100%",
          position: "relative",
        }}
      >
        {items.map((virtualRow) => {
          const row = flatRows[virtualRow.index];
          if (!row) return null;
          if (row.kind === "section") {
            return (
              <div
                key={`s-${row.section}-${virtualRow.index}`}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                className="task-stream__section"
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                <h2
                  className={`task-stream__heading ${sectionHeadingClass(row.section, activePlatform)}`}
                >
                  {sectionHeading(row.section, activePlatform)}
                </h2>
              </div>
            );
          }
          const t = row.task;
          return (
            <div
              key={t.id}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              <div className="stack task-stack">
                <TaskCardPreview
                  t={t}
                  section={row.section}
                  activePlatform={activePlatform}
                  onOpenDetail={onOpenDetail}
                  onOpenHelp={onOpenHelp}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Считает плоских строк (секция + карточки) для порога виртуализации. */
export function countTaskFeedRows(
  sectionKeys: string[],
  grouped: Map<string, TaskDto[]>
): number {
  let n = 0;
  for (const section of sectionKeys) {
    n += 1;
    n += grouped.get(section)?.length ?? 0;
  }
  return n;
}

export function TaskVirtualFeed(props: CommonProps) {
  const n = countTaskFeedRows(props.sectionKeys, props.grouped);
  if (n < TASK_FEED_VIRTUAL_THRESHOLD) {
    return <TaskFeedStatic {...props} />;
  }
  return <TaskFeedWindowVirtual {...props} />;
}
