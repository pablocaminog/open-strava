# Settings Connections Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `/settings/connections` page showing a card grid of 18 data-source integrations, with real OAuth status for Strava/Garmin and export-instructions cards for all others.

**Architecture:** Two new API endpoints (`GET /me/connections`, `DELETE /me/connections/:provider`) added to `settings.ts`. A static `connectors.ts` data file defines all 18 connectors. A new Astro page `settings/connections.astro` fetches connection status and renders cards. The existing `settings.astro` gets a sub-nav and loses its "Connected accounts" panel.

**Tech Stack:** TypeScript, Hono (API), Astro (web), Cloudflare D1 (DB), Vitest (tests)

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `apps/api/src/routes/settings.ts` | Modify | Add GET /me/connections + DELETE /me/connections/:provider |
| `apps/api/test/settings.routes.test.ts` | Create | Tests for the two new endpoints |
| `apps/web/src/data/connectors.ts` | Create | Static registry of all 18 connectors |
| `apps/web/src/pages/settings/connections.astro` | Create | Full connections card grid page |
| `apps/web/src/pages/settings.astro` | Modify | Add sub-nav, remove Connected accounts panel |

---

## Task 1: API — GET /me/connections + DELETE /me/connections/:provider

**Files:**
- Modify: `apps/api/src/routes/settings.ts`
- Create: `apps/api/test/settings.routes.test.ts`

- [ ] **Step 1.1: Create test file**

Create `apps/api/test/settings.routes.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/index.js';
import { createSession } from '../src/auth/session.js';
import { fakeEnv, type FakeD1 } from './helpers.js';

async function authedEnv(userId = 'u1') {
  const env = fakeEnv();
  const { cookie } = await createSession(env, userId);
  return { env, cookie: cookie.split(';')[0]! };
}

describe('GET /api/v1/me/connections', () => {
  it('returns 401 when not authenticated', async () => {
    const app = buildApp();
    const res = await app.request('/api/v1/me/connections', {}, fakeEnv());
    expect(res.status).toBe(401);
  });

  it('returns empty connections for new user', async () => {
    const { env, cookie } = await authedEnv();
    const app = buildApp();
    const res = await app.request(
      '/api/v1/me/connections',
      { headers: { Cookie: cookie } },
      env,
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { strava: boolean; garmin: boolean };
    expect(data.strava).toBe(false);
    expect(data.garmin).toBe(false);
  });

  it('returns true for connected provider', async () => {
    const { env, cookie } = await authedEnv('u1');
    await (env.DB as FakeD1).exec(
      `INSERT INTO oauth_identities (provider, external_id, user_id, access_token, refresh_token, expires_at, scope)
       VALUES ('strava', 'ext-1', 'u1', 'tok', 'ref', 9999999999, 'read')`,
    );
    const app = buildApp();
    const res = await app.request(
      '/api/v1/me/connections',
      { headers: { Cookie: cookie } },
      env,
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { strava: boolean; garmin: boolean };
    expect(data.strava).toBe(true);
    expect(data.garmin).toBe(false);
  });
});

describe('DELETE /api/v1/me/connections/:provider', () => {
  it('returns 401 when not authenticated', async () => {
    const app = buildApp();
    const res = await app.request(
      '/api/v1/me/connections/strava',
      { method: 'DELETE' },
      fakeEnv(),
    );
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid provider', async () => {
    const { env, cookie } = await authedEnv();
    const app = buildApp();
    const res = await app.request(
      '/api/v1/me/connections/facebook',
      { method: 'DELETE', headers: { Cookie: cookie } },
      env,
    );
    expect(res.status).toBe(400);
  });

  it('deletes the oauth identity and returns ok', async () => {
    const { env, cookie } = await authedEnv('u1');
    await (env.DB as FakeD1).exec(
      `INSERT INTO oauth_identities (provider, external_id, user_id, access_token, refresh_token, expires_at, scope)
       VALUES ('strava', 'ext-1', 'u1', 'tok', 'ref', 9999999999, 'read')`,
    );
    const app = buildApp();
    const res = await app.request(
      '/api/v1/me/connections/strava',
      { method: 'DELETE', headers: { Cookie: cookie } },
      env,
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { ok: boolean };
    expect(data.ok).toBe(true);
  });
});
```

- [ ] **Step 1.2: Run tests to confirm they fail**

```bash
cd /Users/pablo/Projects/pacelore/apps/api && pnpm test -- settings.routes
```

Expected: FAIL — routes not yet implemented.

- [ ] **Step 1.3: Add endpoints to settings.ts**

In `apps/api/src/routes/settings.ts`, update the top comment to include the new routes:

```typescript
 *   GET    /api/v1/me/connections                — list connected OAuth providers
 *   DELETE /api/v1/me/connections/:provider      — disconnect a provider
```

Then add these two route handlers after the existing `settingsRoutes.delete('/me/api-keys/:id', ...)` handler and before `settingsRoutes.delete('/me', ...)`:

```typescript
const VALID_DISCONNECT_PROVIDERS = new Set(['strava', 'garmin']);

settingsRoutes.get('/me/connections', async (c) => {
  const session = c.get('session');
  const rows = await c.env.DB.prepare(
    `SELECT provider FROM oauth_identities WHERE user_id = ?`,
  )
    .bind(session.userId)
    .all<{ provider: string }>();
  const connected = new Set((rows.results ?? []).map((r) => r.provider));
  return c.json({
    strava: connected.has('strava'),
    garmin: connected.has('garmin'),
  });
});

settingsRoutes.delete('/me/connections/:provider', async (c) => {
  const provider = c.req.param('provider');
  const session = c.get('session');
  if (!VALID_DISCONNECT_PROVIDERS.has(provider)) {
    throw new HTTPException(400, { message: 'invalid provider' });
  }
  await c.env.DB.prepare(
    `DELETE FROM oauth_identities WHERE user_id = ? AND provider = ?`,
  )
    .bind(session.userId, provider)
    .run();
  return c.json({ ok: true });
});
```

- [ ] **Step 1.4: Run tests to confirm they pass**

```bash
cd /Users/pablo/Projects/pacelore/apps/api && pnpm test -- settings.routes
```

Expected: all 5 tests pass.

- [ ] **Step 1.5: Run full test suite**

```bash
cd /Users/pablo/Projects/pacelore/apps/api && pnpm test
```

Expected: all tests pass (no regressions).

- [ ] **Step 1.6: Commit**

```bash
cd /Users/pablo/Projects/pacelore
git add apps/api/src/routes/settings.ts apps/api/test/settings.routes.test.ts
git commit -m "feat(api): GET /me/connections + DELETE /me/connections/:provider"
```

---

## Task 2: Create connectors.ts static registry

**Files:**
- Create: `apps/web/src/data/connectors.ts`

- [ ] **Step 2.1: Create the file**

Create `apps/web/src/data/connectors.ts`:

```typescript
export type ConnectorType = 'oauth' | 'upload' | 'thirdparty' | 'future';

export interface Connector {
  id: string;
  name: string;
  logoText: string;
  logoColor: string;
  type: ConnectorType;
  provider?: 'strava' | 'garmin';
  capability: string;
  instructions: string;
  connectUrl?: string;
  importUrl?: string;
}

export const CONNECTORS: Connector[] = [
  // ── Row 1: Devices / Platforms ──────────────────────────────────────────
  {
    id: 'garmin',
    name: 'Garmin Connect',
    logoText: 'garmin',
    logoColor: '#007CC2',
    type: 'oauth',
    provider: 'garmin',
    capability: 'Downloads activities automatically via push webhooks.',
    instructions:
      'Click Connect and sign in to Garmin Connect. New activities sync to Pacelore automatically within minutes of saving.',
    connectUrl: '/api/v1/auth/garmin/start',
  },
  {
    id: 'strava',
    name: 'Strava',
    logoText: 'strava',
    logoColor: '#FC4C02',
    type: 'oauth',
    provider: 'strava',
    capability: 'Downloads activities and backfills the last 90 days.',
    instructions:
      'Click Connect and sign in to Strava. Pacelore immediately imports your last 90 days and syncs new activities automatically.',
    connectUrl: '/api/v1/auth/strava/start',
    importUrl: '/api/v1/me/import/strava',
  },
  {
    id: 'polar',
    name: 'Polar',
    logoText: 'POLAR',
    logoColor: '#D0021B',
    type: 'upload',
    capability: 'Downloads activities via FIT export from Polar Flow.',
    instructions:
      '<ol><li>Open <a href="https://flow.polar.com" target="_blank" rel="noopener">flow.polar.com</a> and sign in.</li><li>Go to Training → select a session.</li><li>Click Export → Training session (.fit).</li><li>Upload the file on the <a href="/upload">Upload page</a>.</li></ol>',
  },
  {
    id: 'suunto',
    name: 'Suunto',
    logoText: 'SUUNTO',
    logoColor: '#1A1A2E',
    type: 'upload',
    capability: 'Downloads activities via FIT export from Suunto.',
    instructions:
      '<ol><li>Open <a href="https://www.suunto.com" target="_blank" rel="noopener">suunto.com</a> and sign in → Diary.</li><li>Select an activity → click the export icon.</li><li>Choose Export FIT file.</li><li>Upload the file on the <a href="/upload">Upload page</a>.</li></ol>',
  },
  {
    id: 'coros',
    name: 'COROS',
    logoText: 'COROS',
    logoColor: '#E02020',
    type: 'upload',
    capability: 'Downloads activities via FIT export from the COROS app.',
    instructions:
      '<ol><li>Open the COROS app → Activities → tap an activity.</li><li>Tap Share → Export FIT.</li><li>Upload the file on the <a href="/upload">Upload page</a>.</li></ol>',
  },
  {
    id: 'wahoo',
    name: 'Wahoo',
    logoText: 'wahoo',
    logoColor: '#EE1C25',
    type: 'upload',
    capability: 'Downloads rides via FIT export from the Wahoo app.',
    instructions:
      '<ol><li>Open the Wahoo Fitness app → Workouts → tap a workout.</li><li>Tap the share icon → Export FIT.</li><li>Upload the file on the <a href="/upload">Upload page</a>.</li></ol>',
  },
  {
    id: 'zwift',
    name: 'Zwift',
    logoText: 'ZWIFT',
    logoColor: '#F47920',
    type: 'upload',
    capability: 'Downloads rides via FIT file or Strava sync.',
    instructions:
      'FIT files are saved automatically to <code>Documents/Zwift/Activities/</code> on your computer — upload them on the <a href="/upload">Upload page</a>. Or connect Strava above; Zwift syncs rides there automatically.',
  },
  {
    id: 'concept2',
    name: 'Concept2',
    logoText: 'concept2',
    logoColor: '#003DA5',
    type: 'upload',
    capability: 'Downloads rowing and ski erg sessions via FIT export.',
    instructions:
      '<ol><li>Sign in at <a href="https://log.concept2.com" target="_blank" rel="noopener">log.concept2.com</a> → Workouts.</li><li>Select a workout → click Export → FIT.</li><li>Upload the file on the <a href="/upload">Upload page</a>.</li></ol>',
  },
  {
    id: 'huawei',
    name: 'Huawei Health',
    logoText: 'HUAWEI',
    logoColor: '#CF0A2C',
    type: 'upload',
    capability: 'Downloads activities via FIT export from Huawei Health.',
    instructions:
      '<ol><li>Open Huawei Health app → Me → Health Records → Activities.</li><li>Select an activity → tap Share → Export FIT.</li><li>Upload the file on the <a href="/upload">Upload page</a>.</li></ol>',
  },
  // ── Row 2: Virtual / Indoor / Wellness ──────────────────────────────────
  {
    id: 'hammerhead',
    name: 'Hammerhead',
    logoText: 'HAMMERHEAD',
    logoColor: '#1A1A1A',
    type: 'thirdparty',
    capability: 'Downloads Karoo rides via Strava sync or FIT export.',
    instructions:
      'Karoo automatically syncs rides to Strava — connect Strava above. Or export FIT files from the Karoo app and upload them on the <a href="/upload">Upload page</a>.',
  },
  {
    id: 'biketerra',
    name: 'Biketerra',
    logoText: 'biketerra',
    logoColor: '#E63946',
    type: 'thirdparty',
    capability: 'Downloads indoor rides via FIT export.',
    instructions:
      'In the Biketerra app, tap an activity → Share → Export FIT. Upload the file on the <a href="/upload">Upload page</a>.',
  },
  {
    id: 'mywhoosh',
    name: 'MyWhoosh',
    logoText: 'MyWhoosh',
    logoColor: '#1B1B2F',
    type: 'thirdparty',
    capability: 'Downloads rides via Strava sync.',
    instructions:
      'In MyWhoosh go to Settings → Connected Apps → link your Strava account. Then connect Strava above — rides sync automatically.',
  },
  {
    id: 'rouvy',
    name: 'Rouvy',
    logoText: 'ROUVY',
    logoColor: '#00B5E2',
    type: 'thirdparty',
    capability: 'Downloads rides via Strava sync.',
    instructions:
      'In Rouvy go to Profile → Connections → connect Strava. Then connect Strava above — rides sync automatically.',
  },
  {
    id: 'oura',
    name: 'Oura',
    logoText: 'OURA',
    logoColor: '#333333',
    type: 'future',
    capability: 'Downloads wellness data from Oura Ring.',
    instructions: '',
  },
  {
    id: 'whoop',
    name: 'WHOOP',
    logoText: 'WHOOP',
    logoColor: '#000000',
    type: 'future',
    capability: 'Downloads wellness data from WHOOP.',
    instructions: '',
  },
  {
    id: 'googlefit',
    name: 'Google Fit',
    logoText: 'Google Fit',
    logoColor: '#4285F4',
    type: 'future',
    capability: 'Downloads wellness data from Google Fit.',
    instructions: '',
  },
  {
    id: 'amazfit',
    name: 'Amazfit',
    logoText: 'amazfit',
    logoColor: '#000000',
    type: 'future',
    capability: 'Downloads activities and wellness data.',
    instructions: '',
  },
  {
    id: 'apple',
    name: 'Apple Health',
    logoText: 'Apple Health',
    logoColor: '#FF2D55',
    type: 'future',
    capability: 'Downloads health and activity data.',
    instructions: '',
  },
];
```

- [ ] **Step 2.2: Commit**

```bash
cd /Users/pablo/Projects/pacelore
git add apps/web/src/data/connectors.ts
git commit -m "feat(web): add connectors.ts static registry — 18 connectors"
```

---

## Task 3: Create connections.astro page

**Files:**
- Create: `apps/web/src/pages/settings/connections.astro`

- [ ] **Step 3.1: Create the directory and file**

Create `apps/web/src/pages/settings/connections.astro`:

```astro
---
import Shell from '../../layouts/Shell.astro';
import { CONNECTORS } from '../../data/connectors.ts';
---

<Shell title="Connections" active="settings">
  <div class="stack" style="gap: 24px;">
    <header>
      <h1 class="h1" style="font-size: 28px;">Connections</h1>
      <p class="muted body-sm" style="margin-top: 4px;">
        Connect data sources to automatically import activities, or follow the instructions to export and upload manually.
      </p>
    </header>

    <!-- Sub-nav -->
    <nav class="row" style="gap: 0; border-bottom: 1px solid var(--border); margin-bottom: 4px;">
      <a href="/settings" class="subnav-link">Settings</a>
      <a href="/settings/connections" class="subnav-link subnav-active">Connections</a>
    </nav>

    <!-- Card grid -->
    <div
      id="connections-grid"
      style="display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px;"
    >
      {CONNECTORS.map((c) => (
        <div
          class={`panel connector-card connector-type-${c.type}`}
          data-connector-id={c.id}
          data-provider={c.provider ?? ''}
          style="display: flex; flex-direction: column; gap: 10px; padding: 16px; min-height: 180px;"
        >
          <!-- Logo -->
          <div
            class="connector-logo"
            style={`font-weight: 800; font-size: 18px; letter-spacing: -0.5px; color: ${c.logoColor}; line-height: 1.2;`}
          >
            {c.logoText}
          </div>

          <!-- Capability -->
          <p class="caption" style="margin: 0; flex: 1;">{c.capability}</p>

          <!-- Future badge -->
          {c.type === 'future' && (
            <span class="chip chip-muted" style="align-self: flex-start;">Coming soon</span>
          )}

          <!-- OAuth card actions (rendered by JS based on connection status) -->
          {c.type === 'oauth' && (
            <div class="connector-actions" data-provider={c.provider}>
              <div class="oauth-disconnected">
                <a href={c.connectUrl} class="btn btn-primary btn-sm">Connect</a>
              </div>
              <div class="oauth-connected" style="display: none; flex-direction: column; gap: 6px;">
                <span class="chip chip-green">✓ Connected</span>
                <div class="row" style="gap: 6px;">
                  {c.importUrl && (
                    <button
                      class="btn btn-secondary btn-sm"
                      data-import={c.importUrl}
                    >Import</button>
                  )}
                  <button
                    class="btn btn-ghost btn-sm"
                    data-disconnect={c.provider}
                  >Disconnect</button>
                </div>
              </div>
            </div>
          )}

          <!-- Upload card actions -->
          {c.type === 'upload' && (
            <div style="display: flex; flex-direction: column; gap: 6px;">
              <details>
                <summary class="btn btn-ghost btn-sm" style="cursor: pointer; list-style: none; display: inline-flex; align-items: center; gap: 4px;">
                  How to export ▾
                </summary>
                <div
                  class="caption"
                  style="margin-top: 8px; padding: 10px; background: var(--surface-2); border-radius: 6px; line-height: 1.6;"
                  set:html={c.instructions}
                />
              </details>
              <a href="/upload" class="btn btn-secondary btn-sm" style="align-self: flex-start;">
                Upload FIT ↗
              </a>
            </div>
          )}

          <!-- Third-party card -->
          {c.type === 'thirdparty' && (
            <div
              class="caption"
              style="padding: 10px; background: var(--surface-2); border-radius: 6px; line-height: 1.6;"
              set:html={c.instructions}
            />
          )}
        </div>
      ))}
    </div>

    <p class="caption" style="margin: 0;">
      Activities uploaded via FIT/TCX/GPX appear in your feed immediately. OAuth connections sync new activities automatically.
    </p>
  </div>
</Shell>

<style>
  .subnav-link {
    padding: 8px 16px;
    font-size: 14px;
    font-weight: 500;
    color: var(--muted);
    text-decoration: none;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
  }
  .subnav-link:hover { color: var(--fg); }
  .subnav-active {
    color: var(--fg);
    border-bottom-color: var(--fg);
  }
  .connector-card { transition: box-shadow 0.15s; }
  .connector-card:hover { box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
  .connector-type-future { opacity: 0.6; }
  .chip-green {
    background: #dcfce7;
    color: #166534;
    padding: 2px 8px;
    border-radius: 99px;
    font-size: 12px;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  :root[data-theme='dark'] .chip-green,
  :root.dark .chip-green {
    background: #14532d;
    color: #86efac;
  }
  details > summary::-webkit-details-marker { display: none; }
</style>

<script>
  type Connections = { strava: boolean; garmin: boolean };

  async function init() {
    const res = await fetch('/api/v1/me/connections', { credentials: 'include' });
    if (!res.ok) return;
    const data = (await res.json()) as Connections;

    // Update each OAuth card based on connection status
    document.querySelectorAll<HTMLElement>('.connector-actions[data-provider]').forEach((el) => {
      const provider = el.dataset['provider'] as keyof Connections;
      const connected = data[provider] ?? false;
      const disconnectedEl = el.querySelector<HTMLElement>('.oauth-disconnected');
      const connectedEl = el.querySelector<HTMLElement>('.oauth-connected');
      if (!disconnectedEl || !connectedEl) return;
      disconnectedEl.style.display = connected ? 'none' : '';
      connectedEl.style.display = connected ? 'flex' : 'none';
    });

    // Wire import buttons
    document.querySelectorAll<HTMLButtonElement>('button[data-import]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const url = btn.dataset['import']!;
        btn.disabled = true;
        btn.textContent = 'Importing…';
        const r = await fetch(url, { method: 'POST', credentials: 'include' });
        if (r.ok) {
          const body = (await r.json()) as { queued?: number };
          btn.textContent = body.queued != null ? `Queued ${body.queued}` : 'Done';
        } else {
          btn.textContent = `Failed (${r.status})`;
          btn.disabled = false;
        }
      });
    });

    // Wire disconnect buttons
    document.querySelectorAll<HTMLButtonElement>('button[data-disconnect]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const provider = btn.dataset['disconnect']!;
        if (!confirm(`Disconnect ${provider}? Future activities won't sync until you reconnect.`)) return;
        btn.disabled = true;
        const r = await fetch(`/api/v1/me/connections/${provider}`, {
          method: 'DELETE',
          credentials: 'include',
        });
        if (r.ok) {
          // Update UI: show disconnected state
          const actionsEl = btn.closest<HTMLElement>('.connector-actions');
          if (actionsEl) {
            actionsEl.querySelector<HTMLElement>('.oauth-disconnected')!.style.display = '';
            actionsEl.querySelector<HTMLElement>('.oauth-connected')!.style.display = 'none';
          }
        } else {
          btn.disabled = false;
        }
      });
    });
  }

  init().catch(console.error);
</script>
```

- [ ] **Step 3.2: Build to verify no type errors**

```bash
cd /Users/pablo/Projects/pacelore/apps/web && pnpm build 2>&1 | tail -10
```

Expected: build succeeds.

- [ ] **Step 3.3: Commit**

```bash
cd /Users/pablo/Projects/pacelore
git add apps/web/src/pages/settings/connections.astro
git commit -m "feat(web): /settings/connections page — 18-connector card grid"
```

---

## Task 4: Update settings.astro — add sub-nav, remove Connected accounts panel

**Files:**
- Modify: `apps/web/src/pages/settings.astro`

- [ ] **Step 4.1: Add sub-nav after the header**

In `apps/web/src/pages/settings.astro`, find the `<header>` block:

```html
    <header>
      <h1 class="h1" style="font-size: 28px;">Settings</h1>
      <p class="muted body-sm" style="margin-top: 4px;">
        Thresholds drive every load metric — set them honestly. Connections pull activities in;
        keys let third parties read on your behalf.
      </p>
    </header>
```

Replace with:

```html
    <header>
      <h1 class="h1" style="font-size: 28px;">Settings</h1>
      <p class="muted body-sm" style="margin-top: 4px;">
        Thresholds drive every load metric — set them honestly.
      </p>
    </header>

    <nav class="row" style="gap: 0; border-bottom: 1px solid var(--border); margin-bottom: 4px;">
      <a href="/settings" class="subnav-link subnav-active">Settings</a>
      <a href="/settings/connections" class="subnav-link">Connections</a>
    </nav>
```

- [ ] **Step 4.2: Add subnav CSS**

At the bottom of the `<style>` block in settings.astro (or add one if none exists), add:

```css
  .subnav-link {
    padding: 8px 16px;
    font-size: 14px;
    font-weight: 500;
    color: var(--muted);
    text-decoration: none;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
  }
  .subnav-link:hover { color: var(--fg); }
  .subnav-active {
    color: var(--fg);
    border-bottom-color: var(--fg);
  }
```

- [ ] **Step 4.3: Remove the Connected accounts panel**

Find and remove the entire `<div class="panel">` block that contains "Connected accounts". It spans from:
```html
    <div class="panel">
      <div class="panel-header"><h3 class="h3" style="font-size: 16px;">Connected accounts</h3></div>
```
…through its closing `</div>` (which includes Strava, Garmin, Zwift, Apple Health rows and the IMPORT ALL GARMIN DATA / strava-import button logic).

Also remove the `stravaImportBtn` event listener block from the `<script>` section (it references `strava-import` which no longer exists in the DOM).

- [ ] **Step 4.4: Build to verify**

```bash
cd /Users/pablo/Projects/pacelore/apps/web && pnpm build 2>&1 | tail -10
```

Expected: build succeeds, no errors about missing DOM elements.

- [ ] **Step 4.5: Commit**

```bash
cd /Users/pablo/Projects/pacelore
git add apps/web/src/pages/settings.astro
git commit -m "feat(web): settings page — add sub-nav, move connections to /settings/connections"
```

---

## Task 5: Deploy

- [ ] **Step 5.1: Run full API test suite**

```bash
cd /Users/pablo/Projects/pacelore/apps/api && pnpm test
```

Expected: all tests pass.

- [ ] **Step 5.2: Deploy API**

```bash
cd /Users/pablo/Projects/pacelore/apps/api && npx wrangler deploy 2>&1 | tail -6
```

Expected: `Deployed pacelore-api triggers`

- [ ] **Step 5.3: Deploy web**

```bash
cd /Users/pablo/Projects/pacelore/apps/web && PATH="$PATH:/Users/pablo/Projects/pacelore/apps/api/node_modules/.bin" pnpm run deploy 2>&1 | tail -6
```

Expected: `Deployed pacelore-web triggers`

- [ ] **Step 5.4: Smoke test**

1. Navigate to `/settings` — verify sub-nav shows "Settings | Connections", no Connected accounts panel
2. Click "Connections" → verify `/settings/connections` loads 18 cards in a responsive grid
3. Verify Garmin/Strava cards show "Connect" button
4. Verify Polar/Suunto/etc cards show "How to export ▾" details toggle + "Upload FIT ↗"
5. Verify Oura/Whoop/etc cards show "Coming soon" chip and are faded
6. After connecting Strava, verify the Strava card updates to show ✓ Connected + Import/Disconnect buttons

- [ ] **Step 5.5: Final commit**

```bash
cd /Users/pablo/Projects/pacelore
git add -A
git commit -m "chore: deploy connections page"
```

---

## Self-Review

**Spec coverage:**
- ✅ `/settings/connections` new page (Task 3)
- ✅ Sub-nav Settings | Connections (Tasks 3 + 4)
- ✅ `GET /me/connections` endpoint (Task 1)
- ✅ `DELETE /me/connections/:provider` endpoint (Task 1)
- ✅ All 4 card types: oauth, upload, thirdparty, future (Tasks 2 + 3)
- ✅ All 18 connectors with correct type assignments (Task 2)
- ✅ Step-by-step export instructions for upload cards (Task 2 + 3)
- ✅ Connected status rendered via JS after fetch (Task 3)
- ✅ Import button wired to existing endpoints (Task 3)
- ✅ Disconnect button calls DELETE endpoint (Task 3)
- ✅ Connected accounts panel removed from settings.astro (Task 4)
- ✅ Tests for both new endpoints (Task 1)

**Type consistency:**
- `Connector.provider` typed as `'strava' | 'garmin'` in connectors.ts, used as `keyof Connections` in the page script — both use same literals ✅
- `VALID_DISCONNECT_PROVIDERS` in settings.ts matches the provider values in connectors.ts ✅
- `connectUrl`, `importUrl` optional fields — only present on oauth connectors ✅

**Placeholder scan:** No TBDs. All code blocks complete. Instructions are literal HTML strings, not descriptions.
