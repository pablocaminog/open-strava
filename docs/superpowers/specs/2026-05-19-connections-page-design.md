# Settings Connections Page Design

**Date:** 2026-05-19  
**Status:** Approved

## Overview

New `/settings/connections` page showing a card grid of all supported data sources. Replaces the "Connected accounts" section in `/settings`. Cards explain how to get data into Pacelore for every supported device/platform.

---

## Navigation

Sub-nav row added to both `/settings` and `/settings/connections`:

```
Settings  |  Connections  |  API Keys
```

Current `/settings` removes its "Connected accounts" panel (replaced by the new page).

---

## New API Endpoint

`GET /api/v1/me/connections`

Returns which OAuth providers the user has active tokens for:

```json
{ "strava": true, "garmin": false }
```

Query: `SELECT provider FROM oauth_identities WHERE user_id = ?` — returns set of connected provider names.

---

## Card Types

| Type | Behavior |
|------|----------|
| `oauth` | Shows Connect button → OAuth redirect. When connected: green badge, athlete name, Import + Disconnect buttons. |
| `upload` | Step-by-step export instructions + "Upload FIT" button linking to `/upload`. |
| `thirdparty` | Instructions only — usually "connect via Strava" or "export FIT". No action button. |
| `future` | Logo + "Coming soon" chip. No action. |

---

## Connector Registry

Static TypeScript config at `apps/web/src/data/connectors.ts`. Each entry:

```typescript
interface Connector {
  id: string;
  name: string;
  logo: string;          // SVG inline string or img src path
  type: 'oauth' | 'upload' | 'thirdparty' | 'future';
  provider?: string;     // oauth_identities.provider value (oauth type only)
  capability: string;    // one-line: "Downloads activities"
  instructions: string;  // HTML string with steps
  connectUrl?: string;   // oauth type: /api/v1/auth/:provider/start
  importUrl?: string;    // oauth type: /api/v1/me/import/:provider
}
```

### Row 1 — Devices/Wearables

**Garmin Connect** (`oauth`, provider: `garmin`)
- Capability: Downloads activities automatically via push webhooks
- Instructions: Click Connect → sign in to Garmin Connect → authorize Pacelore. New activities sync automatically within minutes of saving.
- Connect URL: `/api/v1/auth/garmin/start`

**Strava** (`oauth`, provider: `strava`)
- Capability: Downloads activities, backfills last 90 days
- Instructions: Click Connect → sign in to Strava → authorize. Imports last 90 days immediately. New activities sync automatically.
- Connect URL: `/api/v1/auth/strava/start`
- Import URL: `/api/v1/me/import/strava`

**Polar** (`upload`)
- Capability: Downloads activities via FIT export
- Instructions: 1. Open [flow.polar.com](https://flow.polar.com) → Training → select a session. 2. Click Export → Training session (.fit). 3. Upload the file on the Upload page.

**Suunto** (`upload`)
- Capability: Downloads activities via FIT export
- Instructions: 1. Open [www.suunto.com](https://www.suunto.com) and sign in → Diary → select activity. 2. Click the export icon → Export FIT file. 3. Upload the file on the Upload page.

**COROS** (`upload`)
- Capability: Downloads activities via FIT export
- Instructions: 1. Open the COROS app → Activities → tap an activity. 2. Tap Share → Export FIT. 3. Upload the file on the Upload page.

**Wahoo** (`upload`)
- Capability: Downloads activities via FIT export
- Instructions: 1. Open Wahoo Fitness app → Workouts → tap a workout. 2. Tap the share icon → Export FIT. 3. Upload the file on the Upload page.

**Zwift** (`upload`)
- Capability: Downloads rides via FIT file or Strava sync
- Instructions: FIT files are saved automatically to `Documents/Zwift/Activities/` on your computer. Upload them on the Upload page. Alternatively, connect Strava above — Zwift syncs rides there automatically.

**Concept2** (`upload`)
- Capability: Downloads rowing/skiing sessions via FIT export
- Instructions: 1. Sign in at [log.concept2.com](https://log.concept2.com) → Workouts → select a workout. 2. Click Export → FIT. 3. Upload the file on the Upload page.

**Huawei Health** (`upload`)
- Capability: Downloads activities via FIT export
- Instructions: 1. Open Huawei Health app → Me → Health Records → Activities → select activity. 2. Tap Share → Export FIT. 3. Upload the file on the Upload page.

### Row 2 — Virtual/Indoor + Wellness

**Hammerhead** (`thirdparty`)
- Capability: Downloads rides via Strava sync or FIT export
- Instructions: Karoo automatically syncs rides to Strava — connect Strava above. Or: export FIT files from the Karoo app and upload them on the Upload page.

**Biketerra** (`thirdparty`)
- Capability: Downloads indoor rides via FIT export
- Instructions: In the Biketerra app, tap an activity → Share → Export FIT. Upload the file on the Upload page.

**MyWhoosh** (`thirdparty`)
- Capability: Downloads rides via Strava sync
- Instructions: In MyWhoosh, go to Settings → Connected Apps → link your Strava account. Then connect Strava above — rides will sync automatically.

**Rouvy** (`thirdparty`)
- Capability: Downloads rides via Strava sync
- Instructions: In Rouvy, go to Profile → Connections → connect Strava. Then connect Strava above — rides will sync automatically.

**Oura** (`future`) — Coming soon

**Whoop** (`future`) — Coming soon

**Google Fit** (`future`) — Coming soon

**Amazfit** (`future`) — Coming soon

**Apple Health** (`future`) — Requires native iOS app — coming soon

---

## Page Structure

`apps/web/src/pages/settings/connections.astro`

```
<Shell title="Connections" active="settings">
  sub-nav: Settings | Connections | API Keys
  
  <div class="grid-tiles" style="grid-template-columns: repeat(auto-fill, minmax(240px, 1fr))">
    [ConnectorCard for each connector]
  </div>
  
  <footer note>
    Activities uploaded via FIT/TCX/GPX appear in your feed immediately.
    OAuth connections sync automatically.
  </footer>
</Shell>
```

---

## Card HTML Pattern

**OAuth card (disconnected):**
```html
<div class="panel connector-card">
  <div class="connector-logo">[logo]</div>
  <p class="caption">[capability]</p>
  <a href="[connectUrl]" class="btn btn-primary btn-sm">Connect</a>
</div>
```

**OAuth card (connected):**
```html
<div class="panel connector-card connector-connected">
  <div class="connector-logo">[logo]</div>
  <div class="chip chip-green">✓ Connected</div>
  <p class="caption">[capability]</p>
  <div class="row">
    <button class="btn btn-secondary btn-sm" data-import="[provider]">Import</button>
    <button class="btn btn-ghost btn-sm" data-disconnect="[provider]">Disconnect</button>
  </div>
</div>
```

**Upload card:**
```html
<div class="panel connector-card">
  <div class="connector-logo">[logo]</div>
  <p class="caption">[capability]</p>
  <details>
    <summary class="btn btn-ghost btn-sm">How to export</summary>
    <div class="instructions">[steps]</div>
  </details>
  <a href="/upload" class="btn btn-secondary btn-sm">Upload FIT ↗</a>
</div>
```

**Future card:**
```html
<div class="panel connector-card connector-future">
  <div class="connector-logo">[logo]</div>
  <span class="chip chip-muted">Coming soon</span>
</div>
```

---

## Connected Status Flow

1. Page loads → fetches `GET /api/v1/me/connections`
2. Response `{ strava: true, garmin: false }` used to render correct card state
3. Import button → `POST /api/v1/me/import/:provider` (existing endpoints)
4. Disconnect button → `DELETE /api/v1/me/connections/:provider` (new endpoint, deletes from `oauth_identities`)

---

## New API Endpoint: Disconnect

`DELETE /api/v1/me/connections/:provider`

```sql
DELETE FROM oauth_identities WHERE user_id = ? AND provider = ?
```

Returns `{ ok: true }`.

---

## Settings Page Change

Remove the "Connected accounts" panel from `/settings`. Add sub-nav pointing to `/settings/connections`.

Add sub-nav to `/settings/connections` pointing back to `/settings` and `/settings/api-keys` (if that page exists, else just `/settings`).

---

## Logo Assets

Logos rendered as `<img>` tags pointing to CDN paths or inline SVGs in `connectors.ts`. Use public brand assets (PNG/SVG) stored in `apps/web/public/logos/`. One file per connector: `garmin.svg`, `strava.svg`, `polar.svg`, etc.

---

## Out of Scope

- Real OAuth for Polar, Suunto, Coros, Wahoo (requires vendor developer accounts + backend routes)
- Wellness data (Oura, Whoop, Google Fit) — no API integration yet
- Per-connector sync settings (checkboxes like Intervals.icu) — future iteration
