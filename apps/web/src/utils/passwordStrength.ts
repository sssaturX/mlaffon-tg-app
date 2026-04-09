/** Оценка для UX; API принимает пароль от 8 символов. */

export type PasswordStrengthLevel = "weak" | "fair" | "medium" | "strong";

export type PasswordStrengthResult = {
  score: number;
  level: PasswordStrengthLevel;
  labelRu: string;
  /** Процент для полосы 0–100 */
  percent: number;
  checks: {
    minLength: boolean;
    hasLower: boolean;
    hasUpper: boolean;
    hasDigit: boolean;
    hasSpecial: boolean;
  };
};

function hasLower(s: string): boolean {
  return /[a-zа-яё]/.test(s);
}

function hasUpper(s: string): boolean {
  return /[A-ZА-ЯЁ]/.test(s);
}

function hasDigit(s: string): boolean {
  return /\d/.test(s);
}

function hasSpecial(s: string): boolean {
  return /[^a-zA-Zа-яА-ЯёЁ0-9]/.test(s);
}

/**
 * Счёт 0–5 по правилам; уровень и процент для UI.
 * Для регистрации требуем минимум `medium` (см. `passwordMeetsPolicy`).
 */
export function evaluatePasswordStrength(password: string): PasswordStrengthResult {
  const checks = {
    minLength: password.length >= 8,
    hasLower: hasLower(password),
    hasUpper: hasUpper(password),
    hasDigit: hasDigit(password),
    hasSpecial: hasSpecial(password),
  };

  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (checks.hasLower && checks.hasUpper) score += 1;
  if (checks.hasDigit) score += 1;
  if (checks.hasSpecial) score += 1;

  let level: PasswordStrengthLevel;
  let labelRu: string;
  let percent: number;

  if (password.length === 0) {
    level = "weak";
    labelRu = "Введите пароль";
    percent = 0;
  } else if (!checks.minLength) {
    level = "weak";
    labelRu = "Слишком короткий";
    percent = 15;
  } else if (score <= 2) {
    level = "fair";
    labelRu = "Слабый";
    percent = 35;
  } else if (score <= 3) {
    level = "medium";
    labelRu = "Средний";
    percent = 65;
  } else {
    level = "strong";
    labelRu = "Надёжный";
    percent = 100;
  }

  return { score, level, labelRu, percent, checks };
}

/** Минимум для отправки формы регистрации: не слабее «среднего». */
export function passwordMeetsPolicy(result: PasswordStrengthResult): boolean {
  return result.level === "medium" || result.level === "strong";
}
