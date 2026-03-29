#!/usr/bin/env node

import dotenv from 'dotenv';
import { runAgentRegistryCli } from './agentRegistryCli.js';

dotenv.config();

runAgentRegistryCli(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
