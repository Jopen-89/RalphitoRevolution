import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import path from 'path';
import type { Provider } from '../domain/gateway.types.js';
import {
  RUNTIME_EXIT_CODE_FILE_NAME,
  RUNTIME_FAILURE_FILE_NAME,
  RUNTIME_GUARDRAIL_LOG_NAME,
  RUNTIME_LLM_WAITING_FILE_NAME,
  RUNTIME_SESSION_FILE_NAME,
} from '../domain/constants.js';
import { ProjectService } from '../services/ProjectService.js';

export interface RuntimeSessionFileRecord {
  runtimeSessionId: string;
  projectId: string;
  agentId: string;
  agent: string;
  provider: Provider | null;
  model: string | null;
  providerProfile?: string | null;
  baseCommitHash: string;
  branchName: string;
  worktreePath: string;
  tmuxSessionId: string;
  pid: number | null;
  prompt: string;
  beadPath: string | null;
  workItemKey: string | null;
  beadSpecHash: string | null;
  beadSpecVersion: string | null;
  qaConfig: unknown;
  originThreadId: number | null;
  notificationChatId: string | null;
  maxSteps: number;
  maxWallTimeMs: number;
  maxCommandTimeMs: number;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeFailureRecord {
  runtimeSessionId: string;
  kind: string;
  summary: string;
  reasonCode: string | null;
  logTail: string | null;
  createdAt: string;
  updatedAt: string;
}

export function getRuntimeSessionFilePath(worktreePath: string) {
  return path.join(worktreePath, RUNTIME_SESSION_FILE_NAME);
}

export function getRuntimeFailureFilePath(worktreePath: string) {
  return path.join(worktreePath, RUNTIME_FAILURE_FILE_NAME);
}

export function getRuntimeExitCodeFilePath(worktreePath: string) {
  return path.join(worktreePath, RUNTIME_EXIT_CODE_FILE_NAME);
}

export function getGuardrailLogPath(worktreePath: string) {
  return path.join(worktreePath, RUNTIME_GUARDRAIL_LOG_NAME);
}

export function getManagedRuntimeWorktreePath(runtimeSessionId: string, projectId = 'default') {
  return ProjectService.resolveWorktreePath(projectId, runtimeSessionId);
}

export function readRuntimeSessionFile(worktreePath: string) {
  const filePath = getRuntimeSessionFilePath(worktreePath);
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, 'utf8')) as RuntimeSessionFileRecord;
}

export function writeRuntimeSessionFile(worktreePath: string, record: RuntimeSessionFileRecord) {
  writeFileSync(getRuntimeSessionFilePath(worktreePath), `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return record;
}

export function updateRuntimeSessionFile(worktreePath: string, patch: Partial<RuntimeSessionFileRecord>) {
  const current = readRuntimeSessionFile(worktreePath);
  if (!current) throw new Error(`No existe ${RUNTIME_SESSION_FILE_NAME} en ${worktreePath}`);

  const nextRecord = {
    ...current,
    ...patch,
    updatedAt: patch.updatedAt || new Date().toISOString(),
  } satisfies RuntimeSessionFileRecord;

  writeFileSync(getRuntimeSessionFilePath(worktreePath), `${JSON.stringify(nextRecord, null, 2)}\n`, 'utf8');
  return nextRecord;
}

export function readRuntimeFailureRecord(worktreePath: string) {
  const filePath = getRuntimeFailureFilePath(worktreePath);
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, 'utf8')) as RuntimeFailureRecord;
}

export function writeRuntimeFailureRecord(worktreePath: string, failure: RuntimeFailureRecord) {
  writeFileSync(getRuntimeFailureFilePath(worktreePath), `${JSON.stringify(failure, null, 2)}\n`, 'utf8');
  return failure;
}

export function clearRuntimeFailureRecord(worktreePath: string) {
  const filePath = getRuntimeFailureFilePath(worktreePath);
  if (!existsSync(filePath)) return false;
  unlinkSync(filePath);
  return true;
}

export function readRuntimeExitCode(worktreePath: string) {
  const filePath = getRuntimeExitCodeFilePath(worktreePath);
  if (!existsSync(filePath)) return null;

  const rawValue = readFileSync(filePath, 'utf8').trim();
  if (!rawValue) return null;

  const exitCode = Number.parseInt(rawValue, 10);
  return Number.isInteger(exitCode) ? exitCode : null;
}

export function clearRuntimeExitCode(worktreePath: string) {
  const filePath = getRuntimeExitCodeFilePath(worktreePath);
  if (!existsSync(filePath)) return false;
  unlinkSync(filePath);
  return true;
}

export function isWaitingForLlm(worktreePath: string) {
  return existsSync(path.join(worktreePath, RUNTIME_LLM_WAITING_FILE_NAME));
}
