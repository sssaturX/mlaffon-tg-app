const STORAGE_KEY = "mlaffon_onboarding_done_v1";

export function hasSeenOnboarding(): boolean {
  return localStorage.getItem(STORAGE_KEY) === "1";
}

export function dismissOnboarding(): void {
  localStorage.setItem(STORAGE_KEY, "1");
}

type Props = {
  open: boolean;
  onClose: () => void;
};

const privacyUrl =
  import.meta.env.VITE_PRIVACY_POLICY_URL?.trim() || "";

export function OnboardingModal({ open, onClose }: Props) {
  if (!open) return null;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="onb-title">
      <div className="modal-card card stack">
        <h2 id="onb-title" className="modal-title">
          Платформы Twitch и Kick
        </h2>
        <p className="muted modal-text">
          Подключение делается через безопасный вход OAuth: откройте{" "}
          <strong>Профиль</strong> и нажмите кнопку у нужной платформы. После
          авторизации на Twitch или Kick вы вернётесь в приложение, а токены
          хранятся на сервере в зашифрованном виде.
        </p>
        <ul className="onb-list muted">
          <li>Для заданий с проверкой API нужна реальная привязка аккаунта.</li>
          <li>Redirect URI в консоли разработчика должен совпадать с настройками API.</li>
        </ul>
        {privacyUrl ? (
          <p className="m-0">
            <a href={privacyUrl} target="_blank" rel="noopener noreferrer">
              Политика конфиденциальности
            </a>
          </p>
        ) : (
          <p className="muted modal-text--sm">
            Добавьте <code>VITE_PRIVACY_POLICY_URL</code> в сборку, чтобы показать ссылку на политику.
          </p>
        )}
        <button
          type="button"
          className="primary modal-actions"
          onClick={() => {
            dismissOnboarding();
            onClose();
          }}
        >
          Понятно
        </button>
      </div>
    </div>
  );
}
