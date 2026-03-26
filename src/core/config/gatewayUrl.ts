type EnvSource = NodeJS.ProcessEnv | Record<string, string | undefined>;

const DEFAULT_GATEWAY_HOST = '127.0.0.1';
const DEFAULT_GATEWAY_PORT = '3006';
const CHAT_PATH = '/v1/chat';
const HEALTH_PATH = '/health';

function trimEnv(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizePath(pathname: string) {
  return pathname.endsWith('/') && pathname !== '/' ? pathname.slice(0, -1) : pathname;
}

function buildDefaultChatUrl(port: string) {
  return `http://${DEFAULT_GATEWAY_HOST}:${port}${CHAT_PATH}`;
}

export function resolveGatewayChatUrl(env: EnvSource = process.env) {
  const configuredUrl = trimEnv(env.RALPHITO_GATEWAY_URL) || trimEnv(env.GATEWAY_URL);

  if (configuredUrl) {
    return configuredUrl;
  }

  return buildDefaultChatUrl(trimEnv(env.PORT) || DEFAULT_GATEWAY_PORT);
}

export function resolveGatewayHealthUrl(env: EnvSource = process.env) {
  const configuredHealthUrl = trimEnv(env.RALPHITO_GATEWAY_HEALTH_URL);
  if (configuredHealthUrl) {
    return configuredHealthUrl;
  }

  const chatUrl = new URL(resolveGatewayChatUrl(env));
  chatUrl.pathname = HEALTH_PATH;
  chatUrl.search = '';
  chatUrl.hash = '';
  return chatUrl.toString();
}

export function validateGatewayRuntimeConfig(env: EnvSource = process.env) {
  const configuredPort = trimEnv(env.PORT);
  const configuredUrl = trimEnv(env.RALPHITO_GATEWAY_URL) || trimEnv(env.GATEWAY_URL);
  const configuredHealthUrl = trimEnv(env.RALPHITO_GATEWAY_HEALTH_URL);

  if (configuredUrl) {
    const chatUrl = new URL(configuredUrl);
    const normalizedChatPath = normalizePath(chatUrl.pathname);

    if (normalizedChatPath !== CHAT_PATH) {
      throw new Error(`RALPHITO_GATEWAY_URL debe apuntar a ${CHAT_PATH}. Valor actual: ${configuredUrl}`);
    }

    if (configuredPort && chatUrl.port && chatUrl.port !== configuredPort) {
      throw new Error(`PORT=${configuredPort} no coincide con RALPHITO_GATEWAY_URL=${configuredUrl}. Usa una sola fuente de verdad.`);
    }
  }

  if (configuredHealthUrl) {
    const healthUrl = new URL(configuredHealthUrl);
    const normalizedHealthPath = normalizePath(healthUrl.pathname);

    if (normalizedHealthPath !== HEALTH_PATH) {
      throw new Error(`RALPHITO_GATEWAY_HEALTH_URL debe apuntar a ${HEALTH_PATH}. Valor actual: ${configuredHealthUrl}`);
    }

    if (configuredPort && healthUrl.port && healthUrl.port !== configuredPort) {
      throw new Error(`PORT=${configuredPort} no coincide con RALPHITO_GATEWAY_HEALTH_URL=${configuredHealthUrl}. Usa una sola fuente de verdad.`);
    }

    if (configuredUrl) {
      const chatUrl = new URL(configuredUrl);
      if (chatUrl.origin !== healthUrl.origin) {
        throw new Error(`RALPHITO_GATEWAY_URL=${configuredUrl} y RALPHITO_GATEWAY_HEALTH_URL=${configuredHealthUrl} deben compartir origen.`);
      }
    }
  }
}
