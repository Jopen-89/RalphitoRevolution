export type PromptResponse = 'y' | 'n' | '\n' | 'yes' | 'skip' | string;

export interface CredentialPromptInfo {
  type: 'password' | 'username' | 'token' | 'secret';
  tool: string;
  matchedLine: string;
}

export interface PromptMatch {
  tool: string | null;
  matchedLine: string;
  isCredential: boolean;
  response: PromptResponse;
}

interface ToolPattern {
  patterns: RegExp[];
  defaultResponse: PromptResponse;
  credentialPatterns?: RegExp[];
}

const TOOL_PATTERNS: Record<string, ToolPattern> = {
  git: {
    patterns: [
      /\bAbort commit\?/i,
      /\(no\[y\]\)/i,
      /Merge made by the .+ branch\./,
      /Something like this/,
      /[Yy]our name and email address .+git config/,
      /Would you like to .+ and .+ your changes\?/,
      /Do you really want to remove the whole .+ history\?/,
      /Show Deployed Branches\?/,
      /Remove .+ and its history\?/,
    ],
    defaultResponse: 'n',
    credentialPatterns: [
      /(?:password|passphrase)\s*(?:for|:)\s*/i,
      /Enter passphrase.*:/,
    ],
  },
  npm: {
    patterns: [
      /\?\[yN\]/i,
      /Will install \d+ (?:package|packages)/i,
      /Remove \d+ packages\?/i,
      /Deprecation Warning.*\?/i,
      /npm WARN.*\?/i,
    ],
    defaultResponse: 'y',
    credentialPatterns: [
      /npm password:\s*/i,
      /Enter passphrases.*:/i,
    ],
  },
  yarn: {
    patterns: [
      /\?\[y\]/i,
      /Do you want to .+\?/i,
      /Packages in .+ are outdated/i,
      /Need to install \d+ (?:package|packages)/i,
    ],
    defaultResponse: 'y',
    credentialPatterns: [
      /yarn password.*:/i,
      /Enter your password/i,
    ],
  },
  apt: {
    patterns: [
      /Do you want to continue\? \[Y\/n\]/i,
      /Do you want to continue\? \[y\/N\]/i,
      /\[Y\/n\]/i,
      /\[y\/N\]/i,
      /Install .+ anyway\?/i,
    ],
    defaultResponse: 'y',
    credentialPatterns: [],
  },
  pip: {
    patterns: [
      /\?\[y\]/i,
      /Proceed \(Y\/n\)\?/i,
      /The following packages will be .+:.*\?/i,
      /Do you want to download .+\?/i,
    ],
    defaultResponse: 'y',
    credentialPatterns: [
      /password:/i,
    ],
  },
  docker: {
    patterns: [
      /Remove .+ containers\?/i,
      /Delete .+ images\?/i,
      /Remove .+ volumes\?/i,
      /Remove .+ networks\?/i,
    ],
    defaultResponse: 'y',
    credentialPatterns: [
      /password:\s*$/i,
      /(?:docker|registry) login.*:/i,
      /Username:/i,
      /Login Succeeded/i,
    ],
  },
  kubectl: {
    patterns: [
      /\?\(Default: .+\)\s*\[y\]/i,
      /Continue\? \(y\)/i,
      /Do you want to .+\? \(y\)/i,
      /Apply .+ and .+\?/i,
    ],
    defaultResponse: '\n',
    credentialPatterns: [],
  },
  cargo: {
    patterns: [
      /\?\[y\]/i,
      /Do you want to .+\?/i,
      /Some .+ failed .+\?/i,
    ],
    defaultResponse: 'y',
    credentialPatterns: [
      /password:/i,
    ],
  },
  gh: {
    patterns: [
      /Press Enter to .+/i,
      /GitHub authentication/i,
    ],
    defaultResponse: '\n',
    credentialPatterns: [
      /password:\s*$/i,
      /Token:/i,
      /username/i,
    ],
  },
  ssh: {
    patterns: [
      /Are you sure you want to continue connecting/i,
      /\? \(yes\/no\)/i,
    ],
    defaultResponse: 'yes',
    credentialPatterns: [
      /password:\s*$/i,
      /password for/i,
    ],
  },
  make: {
    patterns: [
      /\?\[y\]/i,
      /Stop .+\?/i,
    ],
    defaultResponse: 'y',
    credentialPatterns: [],
  },
  vim: {
    patterns: [
      /\[O\]k/i,
      /Save .+ and quit\?/i,
      /quit anyway\?/i,
      /Vim: .+ still has .+ modifications/i,
    ],
    defaultResponse: 'qa!\n',
    credentialPatterns: [],
  },
};

const CREDENTIAL_ENVS: Record<string, string[]> = {
  docker: ['DOCKER_PASSWORD', 'DOCKER_TOKEN', 'REGISTRY_PASSWORD'],
  npm: ['NPM_TOKEN', 'NPM_PASSWORD'],
  yarn: ['YARN_TOKEN', 'YARN_PASSWORD'],
  git: ['GIT_PASSWORD', 'GIT_TOKEN', 'GIT_ASKPASS'],
  gh: ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ACTOR', 'GH_PASSWORD'],
  ssh: ['SSH_PASSWORD', 'SSH_KEY_PASSPHRASE'],
  pip: ['PIP_PASSWORD'],
  kubectl: ['KUBECONFIG', 'KUBECTL_AUTH'],
};

const GENERIC_CREDENTIAL_PATTERNS = [
  /password:\s*$/i,
  /passphrase:\s*$/i,
  /enter.*password/i,
  /username:\s*$/i,
  /login:\s*$/i,
  /token:\s*$/i,
  /secret:\s*$/i,
];

export function detectToolFromCommand(command: string | null): string | null {
  if (!command) return null;

  const lower = command.toLowerCase();

  if (lower.startsWith('git ')) return 'git';
  if (lower.startsWith('npm ')) return 'npm';
  if (lower.startsWith('yarn ')) return 'yarn';
  if (lower.startsWith('apt ') || lower.includes('apt-get')) return 'apt';
  if (lower.startsWith('pip ') || lower.startsWith('pip3 ')) return 'pip';
  if (lower.startsWith('docker ')) return 'docker';
  if (lower.startsWith('kubectl ') || lower.startsWith('k ')) return 'kubectl';
  if (lower.startsWith('cargo ')) return 'cargo';
  if (lower.startsWith('gh ') || lower.includes('github')) return 'gh';
  if (lower.startsWith('ssh ')) return 'ssh';
  if (lower.startsWith('make ')) return 'make';
  if (lower.includes('vim ') || lower.includes('vi ') || lower.endsWith('vim')) return 'vim';

  return null;
}

export function detectCredentialPrompt(output: string | null): CredentialPromptInfo | null {
  if (!output) return null;

  const lines = output.split('\n').map((l) => l.trim()).filter(Boolean).reverse();

  for (const line of lines) {
    for (const [tool, config] of Object.entries(TOOL_PATTERNS)) {
      if (config.credentialPatterns) {
        for (const pattern of config.credentialPatterns) {
          if (pattern.test(line)) {
            const type = /password|passphrase/i.test(line) ? 'password'
              : /username|login/i.test(line) ? 'username'
              : /token/i.test(line) ? 'token'
              : 'secret';
            return { type, tool, matchedLine: line.slice(0, 200) };
          }
        }
      }
    }
  }

  for (const line of lines) {
    for (const pattern of GENERIC_CREDENTIAL_PATTERNS) {
      if (pattern.test(line)) {
        const type = /password|passphrase/i.test(line) ? 'password'
          : /username|login/i.test(line) ? 'username'
          : /token/i.test(line) ? 'token'
          : 'secret';
        return { type, tool: 'unknown', matchedLine: line.slice(0, 200) };
      }
    }
  }

  return null;
}

export function findMatchingPrompt(output: string | null): PromptMatch | null {
  if (!output) return null;

  const lines = output
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .reverse();

  for (const line of lines) {
    for (const [tool, config] of Object.entries(TOOL_PATTERNS)) {
      for (const pattern of config.patterns) {
        if (pattern.test(line)) {
          const credential = detectCredentialPrompt(output);
          return {
            tool,
            matchedLine: line.length > 180 ? `${line.slice(0, 177)}...` : line,
            isCredential: credential !== null && credential.tool === tool,
            response: config.defaultResponse,
          };
        }
      }
    }
  }

  return null;
}

export function getCredentialFromEnv(tool: string): string | null {
  const envVars = CREDENTIAL_ENVS[tool];
  if (!envVars) return null;

  for (const envVar of envVars) {
    const value = process.env[envVar];
    if (value) return value;
  }

  return null;
}

export function detectSmartDefault(line: string): PromptResponse {
  const lower = line.toLowerCase();

  if (/\(default:\s*n\)/i.test(lower)) return 'n';
  if (/\(default:\s*y\)/i.test(lower)) return 'y';
  if (/\(default:\s+\)/i.test(lower)) return '\n';
  if (/\[y\/n\]/i.test(lower)) return 'y';
  if (/\[n\/y\]/i.test(lower)) return 'n';
  if (/\byes\b/i.test(lower) && /\bno\b/i.test(lower)) return 'yes';
  if (/\bno\b/i.test(lower) && /\byes\b/i.test(lower)) return 'no';

  return 'y';
}
