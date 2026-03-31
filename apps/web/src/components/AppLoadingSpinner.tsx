/** Центрированный индикатор загрузки (без карточки с текстом). */
export function AppLoadingSpinner() {
  return (
    <div className="app-loading" aria-busy="true" aria-label="Загрузка">
      <div className="app-loading__spinner" />
    </div>
  );
}
