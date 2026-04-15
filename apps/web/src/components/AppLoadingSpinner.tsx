/** Глобальный skeleton-фолбэк для lazy-экранов и startup. */
export function AppLoadingSpinner() {
  return (
    <div className="app-loading" aria-busy="true" aria-label="Загрузка">
      <div className="app-loading__spinner-wrap">
        <span className="app-loading__spinner" aria-hidden />
        <span className="app-loading__label">Загрузка...</span>
      </div>
    </div>
  );
}
