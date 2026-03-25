#!/usr/bin/env node

import express from 'express';

const app = express();
const port = Number(process.env.QA_FIXTURE_PORT || 4173);

app.use(express.urlencoded({ extended: true }));

function pageTemplate(title: string, body: string) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f3efe5;
        --surface: #fffdf8;
        --ink: #1f2933;
        --accent: #0f766e;
        --muted: #5b6570;
        --border: #d9d1c3;
      }

      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: Georgia, "Times New Roman", serif;
        background: radial-gradient(circle at top, #fff8eb 0%, var(--bg) 60%);
        color: var(--ink);
      }
      main {
        max-width: 960px;
        margin: 0 auto;
        padding: 48px 20px 72px;
      }
      .shell {
        background: var(--surface);
        border: 1px solid var(--border);
        border-radius: 24px;
        padding: 28px;
        box-shadow: 0 20px 60px rgba(31, 41, 51, 0.08);
      }
      .eyebrow {
        letter-spacing: 0.16em;
        text-transform: uppercase;
        color: var(--accent);
        font-size: 12px;
        margin-bottom: 12px;
      }
      h1 { font-size: 44px; margin: 0 0 12px; }
      p { color: var(--muted); line-height: 1.6; }
      nav { display: flex; gap: 12px; margin: 24px 0; flex-wrap: wrap; }
      a, button {
        color: var(--ink);
        text-decoration: none;
        background: white;
        border: 1px solid var(--border);
        border-radius: 999px;
        padding: 10px 16px;
        font: inherit;
        cursor: pointer;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
        gap: 16px;
        margin-top: 24px;
      }
      .card {
        border: 1px solid var(--border);
        border-radius: 18px;
        padding: 18px;
        background: linear-gradient(180deg, #fffefb 0%, #faf5ea 100%);
      }
      form {
        display: grid;
        gap: 14px;
        max-width: 420px;
        margin-top: 24px;
      }
      label { display: grid; gap: 6px; font-weight: 600; }
      input {
        border-radius: 12px;
        border: 1px solid var(--border);
        padding: 12px 14px;
        font: inherit;
      }
      .hint {
        margin-top: 16px;
        padding: 14px 16px;
        border-radius: 16px;
        border: 1px dashed var(--border);
        background: #fffcf5;
      }
      @media (max-width: 640px) {
        h1 { font-size: 34px; }
        main { padding-top: 28px; }
      }
    </style>
  </head>
  <body>
    <main data-ready="true">
      <div class="shell">
        ${body}
      </div>
    </main>
  </body>
</html>`;
}

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/', (_req, res) => {
  res.send(
    pageTemplate(
      'QA Fixture Home',
      `
        <div class="eyebrow">Miron Fixture</div>
        <h1>Operational cockpit for the QA pipeline</h1>
        <p>This fixture gives Miron and Ricky a stable surface to validate layout, navigation and forms.</p>
        <nav>
          <a href="/">Home</a>
          <a href="/login">Login</a>
          <a href="/settings">Settings</a>
        </nav>
        <form class="grid" method="get" action="/login">
        </form>
        <section class="grid">
          <article class="card"><strong>Home hero</strong><p>Warm palette, serif headline, clear action grouping.</p></article>
          <article class="card"><strong>States</strong><p>Each route exposes selectors for readiness and smoke checks.</p></article>
          <article class="card"><strong>Forms</strong><p>Login includes validation copy for Ricky to exercise.</p></article>
        </section>
      `,
    ),
  );
});

app.get('/login', (_req, res) => {
  res.send(
    pageTemplate(
      'QA Fixture Login',
      `
        <div class="eyebrow">Ricky Fixture</div>
        <h1>Access the operations desk</h1>
        <p>Submit with empty values to trigger a deterministic validation response.</p>
        <nav>
          <a href="/">Home</a>
          <a href="/login">Login</a>
          <a href="/settings">Settings</a>
        </nav>
        <form method="post" action="/login">
          <label>Email<input name="email" type="email" autocomplete="username" /></label>
          <label>Password<input name="password" type="password" autocomplete="current-password" /></label>
          <button type="submit">Enter</button>
        </form>
        <div class="hint">Test account: qa@example.com / invalid-password</div>
      `,
    ),
  );
});

app.post('/login', (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  const valid = email === 'qa@example.com' && password === 'invalid-password';

  res.send(
    pageTemplate(
      'QA Fixture Login Result',
      valid
        ? `
          <div class="eyebrow">Login Result</div>
          <h1>Welcome back</h1>
          <p>You reached a successful post-login state for the smoke test.</p>
          <div class="hint">Authentication simulation completed.</div>
        `
        : `
          <div class="eyebrow">Login Result</div>
          <h1>We could not sign you in</h1>
          <p>Please review the credentials and try again.</p>
          <div class="hint">Validation message rendered as expected.</div>
        `,
    ),
  );
});

app.get('/settings', (_req, res) => {
  res.send(
    pageTemplate(
      'QA Fixture Settings',
      `
        <div class="eyebrow">Settings Fixture</div>
        <h1>Preference controls</h1>
        <p>This route exists to validate secondary layout, navigation continuity and card spacing.</p>
        <nav>
          <a href="/">Home</a>
          <a href="/login">Login</a>
          <a href="/settings">Settings</a>
        </nav>
        <form class="grid" method="get" action="/settings">
        </form>
        <section class="grid">
          <article class="card"><strong>Notifications</strong><p>Email digests are enabled.</p></article>
          <article class="card"><strong>Theme</strong><p>Light mode is active to match Lola's reference rubric.</p></article>
        </section>
      `,
    ),
  );
});

app.listen(port, '127.0.0.1', () => {
  console.log(`QA fixture server listening on http://127.0.0.1:${port}`);
});
