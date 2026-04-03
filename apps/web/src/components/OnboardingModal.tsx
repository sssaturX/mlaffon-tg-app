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
          Twitch и Kick
        </h2>
        <p className="muted modal-text">
          Откройте <strong>Профиль</strong> и нажмите «Подключить» у нужной
          платформы. После входа на Twitch или Kick вы вернётесь в приложение —
          данные для заданий и наград сохраняются безопасно.
        </p>
        <ul className="onb-list muted">
          <li>Часть заданий проверяется автоматически — для них нужна реальная привязка аккаунта.</li>
          <li>Если вход не проходит, попробуйте снова позже или напишите в поддержку.</li>
        </ul>
        {privacyUrl ? (
          <p className="m-0">
            <a href={privacyUrl} target="_blank" rel="noopener noreferrer">
              Политика конфиденциальности
            </a>
          </p>
        ) : null}
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
