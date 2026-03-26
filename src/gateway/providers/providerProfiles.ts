type EnvSource = NodeJS.ProcessEnv | Record<string, string | undefined>;

export interface CodexProfileConfig {
  profile: string;
  env: Record<string, string>;
}

function toProfileKey(profile: string) {
  return profile.trim().replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase();
}

function trimValue(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function listConfiguredCodexProfiles(env: EnvSource = process.env) {
  const profiles = new Set<string>();
  const suffixPattern = /_(HOME|OPENCODE_HOME|XDG_CONFIG_HOME|XDG_DATA_HOME|XDG_STATE_HOME|ENV_JSON)$/;

  for (const key of Object.keys(env)) {
    const match = key.match(/^CODEX_PROFILE_([A-Z0-9_]+)(?:_(HOME|OPENCODE_HOME|XDG_CONFIG_HOME|XDG_DATA_HOME|XDG_STATE_HOME|ENV_JSON))$/);
    if (!match?.[1]) continue;
    const normalized = match[1].replace(suffixPattern, '');
    profiles.add(normalized.toLowerCase().replace(/_/g, '-'));
  }

  return Array.from(profiles).sort();
}

export function resolveCodexProfileConfig(profile: string | undefined, env: EnvSource = process.env): CodexProfileConfig | null {
  const normalizedProfile = trimValue(profile);
  if (!normalizedProfile) return null;

  const profileKey = toProfileKey(normalizedProfile);
  const prefix = `CODEX_PROFILE_${profileKey}_`;
  const resultEnv: Record<string, string> = {
    OPENCODE_PROFILE: normalizedProfile,
  };

  const explicitKeys = ['HOME', 'OPENCODE_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME'];
  for (const key of explicitKeys) {
    const value = trimValue(env[`${prefix}${key}`]);
    if (value) resultEnv[key] = value;
  }

  const jsonEnv = trimValue(env[`${prefix}ENV_JSON`]);
  if (jsonEnv) {
    const parsed = JSON.parse(jsonEnv) as Record<string, unknown>;
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string' && value.trim()) {
        resultEnv[key] = value;
      }
    }
  }

  return {
    profile: normalizedProfile,
    env: resultEnv,
  };
}
