const REQUIRED = ['MONGODB_URI', 'JWT_SECRET'] as const;

/**
 * Fails fast at startup when required settings are missing or still contain
 * the placeholder text from `.env.example`.
 * Stripe / FXRatesAPI keys are validated by the modules that use them.
 */
export function validateEnv(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const problems: string[] = [];

  for (const key of REQUIRED) {
    const value = config[key];
    if (typeof value !== 'string' || value.trim() === '') {
      problems.push(`${key} is missing`);
    } else if (value.trim().startsWith('<')) {
      problems.push(`${key} still has the placeholder value from .env.example`);
    }
  }

  const secret = config.JWT_SECRET;
  if (typeof secret === 'string' && secret.length > 0 && secret.length < 16) {
    problems.push('JWT_SECRET must be at least 16 characters');
  }

  if (problems.length > 0) {
    throw new Error(
      `Invalid environment (copy .env.example to backend/.env):\n - ${problems.join('\n - ')}`,
    );
  }
  return config;
}
