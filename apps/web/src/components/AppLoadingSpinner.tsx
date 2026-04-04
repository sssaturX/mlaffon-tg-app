/** Глобальный skeleton-фолбэк для lazy-экранов и startup. */
export function AppLoadingSpinner() {
  return (
    <div className="app-loading" aria-busy="true" aria-label="Загрузка">
      <div className="app-loading__skeleton">
        <div className="skeleton app-loading__line app-loading__line--title" />
        <div className="skeleton app-loading__line" />
        <div className="skeleton app-loading__line app-loading__line--short" />
        <div className="skeleton app-loading__card" />
        <div className="skeleton app-loading__card" />
      </div>
    </div>
  );
}
