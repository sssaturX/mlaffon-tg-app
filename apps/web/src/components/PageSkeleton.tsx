/** Плейсхолдер при lazy-загрузке экранов и начальной загрузке. */
export function PageSkeleton() {
  return (
    <div className="page-skeleton" aria-busy="true" aria-label="Загрузка">
      <div className="skeleton skeleton--title" />
      <div className="skeleton skeleton--line" />
      <div className="skeleton skeleton--line skeleton--short" />
      <div className="skeleton skeleton--card" />
      <div className="skeleton skeleton--card" />
      <div className="skeleton skeleton--row" />
    </div>
  );
}
