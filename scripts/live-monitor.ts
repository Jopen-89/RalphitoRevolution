#!/usr/bin/env node

import chalk from 'chalk';
import { getAoStructuredSessions, isActiveAoSession } from '../src/features/ao/aoSessionAdapter.js';

interface Session {
  id: string;
  status: string;
  title: string;
}

async function getSessions(): Promise<Session[]> {
  try {
    const sessions = await getAoStructuredSessions();
    return sessions.map((session) => ({
      id: session.id,
      status: session.status || 'unknown',
      title: session.summary || session.issue || session.branch || session.id,
    }));
  } catch {
    return [];
  }
}

async function render() {
  const sessions = await getSessions();
  const structuredSessions = await getAoStructuredSessions().catch(() => []);
  const activeIds = new Set(structuredSessions.filter(isActiveAoSession).map((session) => session.id));
  const running = sessions.filter((session) => activeIds.has(session.id));
  const inactive = sessions.filter((session) => !activeIds.has(session.id));

  console.clear();
  console.log(chalk.cyan('======================================================'));
  console.log(chalk.bold.magenta('    📈 RALPHITO FACTORY - LIVE MONITOR [Actualizando...]'));
  console.log(chalk.cyan('======================================================\n'));

  console.log(chalk.bold.green('🟢 AGENTES TRABAJANDO AHORA (RUNNING):'));
  if (running.length === 0) {
    console.log(chalk.gray('  (Ningún agente trabajando actualmente)'));
  } else {
    running.forEach(s => {
      console.log(`  - [${chalk.bold(s.id)}] 💻 Trabajando en: "${chalk.yellow(s.title)}"`);
    });
  }

  console.log(chalk.bold.gray('\n⚪ AGENTES EN REPOSO / COMPLETADOS:'));
  if (inactive.length === 0) {
    console.log(chalk.gray('  (Sin histórico)'));
  } else {
    // Mostrar solo los últimos 10 para no saturar la pantalla
    inactive.slice(0, 10).forEach(s => {
      let statusColor = chalk.gray;
      if (s.status.toLowerCase() === 'failed' || s.status.toLowerCase() === 'error') statusColor = chalk.red;
      if (s.status.toLowerCase() === 'done' || s.status.toLowerCase() === 'completed') statusColor = chalk.blue;
      
      console.log(`  - ${s.id} (${statusColor(s.status)})`);
    });
  }

  console.log('\nPresiona ' + chalk.bold('q') + ' para volver al menú principal.');
}

// Configurar captura de teclas
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding('utf8');
process.stdin.on('data', (key: string) => {
  if (key === 'q' || key === 'Q' || key === '\u0003') { // q or Ctrl+C
    console.clear();
    process.exit(0);
  }
});

// Ejecución inicial y bucle
render();
setInterval(render, 3000);
