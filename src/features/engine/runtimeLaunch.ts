import path from 'path';
import { getRalphitoDatabasePath } from '../persistence/db/index.js';
import { CommandRunner } from './commandRunner.js';
import { getRuntimeExitCodeFilePath } from './runtimeFiles.js';

function shellEscape(str: string) {
  if (!str.includes("'")) return `'${str}'`;
  const escaped = str.replace(/'/g, "'\\''");
  return `'${escaped}'`;
}

function wrapTrackedCommand(command: string) {
  return [
    'exec',
    '/bin/sh',
    '-lc',
    shellEscape(
      `${command}; status=$?; printf "%s\\n" "$status" > "$RALPHITO_RUNTIME_EXIT_FILE"; exit "$status"`,
    ),
  ].join(' ');
}

function toStringEnv(env: NodeJS.ProcessEnv, extra: Record<string, string>) {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') {
      result[key] = value;
    }
  }

  return {
    ...result,
    ...extra,
  };
}

export interface BuildRuntimeEnvironmentInput {
  runtimeSessionId: string;
  worktreePath: string;
  projectId: string;
  instruction: string;
}

export function buildRuntimeLaunchCommand(agent: string, model: string | null) {
  switch (agent) {
    case 'codex':
      return ['codex', '--full-auto', '--no-alt-screen', ...(model ? ['-m', model] : [])].join(' ');
    case 'opencode':
      return wrapTrackedCommand(
        ['opencode', 'run', '"$RALPHITO_INSTRUCTION"', ...(model ? ['-m', model] : [])].join(' '),
      );
    default:
      throw new Error(`Agent no soportado por Ralphito Engine: ${agent}`);
  }
}

export function buildRuntimeEnvironment(
  input: BuildRuntimeEnvironmentInput,
  env: NodeJS.ProcessEnv = process.env,
) {
  return toStringEnv(env, {
    CI: '1',
    RALPHITO_DB_PATH: getRalphitoDatabasePath(),
    RALPHITO_RUNTIME_SESSION_ID: input.runtimeSessionId,
    RALPHITO_RUNTIME_EXIT_FILE: getRuntimeExitCodeFilePath(input.worktreePath),
    RALPHITO_ENGINE_MANAGED: '1',
    RALPHITO_PROJECT_ID: input.projectId,
    RALPHITO_WORKTREE_PATH: input.worktreePath,
    RALPHITO_INSTRUCTION: input.instruction,
  });
}

export function spawnRuntimeLoop(
  projectPath: string,
  runtimeSessionId: string,
  commandRunner = new CommandRunner(),
  env: NodeJS.ProcessEnv = process.env,
) {
  commandRunner.spawnDetached(
    process.execPath,
    ['--import', 'tsx', path.join(projectPath, 'src/features/engine/cli.ts'), 'run-loop', runtimeSessionId],
    {
      cwd: projectPath,
      env,
    },
  );
}
