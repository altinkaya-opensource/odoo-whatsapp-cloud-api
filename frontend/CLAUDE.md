# CLAUDE.md - Odoo WhatsApp Cloud API Frontend

## Development Environment

- **Language**: TypeScript
- **Framework**: Next.js 16 (App Router, Turbopack)
- **Styling**: Tailwind CSS
- **Icons**: Phosphor Icons (`@phosphor-icons/react`)
- **State**: TanStack Query for server state, React Context for the rest
- **Real-time**: Server-Sent Events fed by the Odoo bus
- **Backend**: Odoo JSON-RPC
- **Package manager**: bun. Do not use npm, yarn or pnpm.

## Project Structure

- `src/app/api/` - API routes that proxy to Odoo
- `src/app/components/` - React components
- `src/app/context/` - Context providers
- `src/app/hooks/` - Custom hooks
- `src/app/lib/` - Odoo client, API client, WhatsApp record mappers and
  message cache, Odoo bus connection, notifications, session cache
- `src/app/locales/` - `en.json` and `tr.json`
- `public/` - Static assets

## Commands

- `bun run dev` - dev server on port 3000
- `bun run build` / `bun run start` - production build and serve
- `bun run lint`, `bun run type-check`, `bun run prettier`, `bun run prettier:fix`
- `bun run test` - vitest
- `docker compose up -d --build`, `docker compose logs -f`

## Translations

No hardcoded user-facing strings. Every one goes through the translation system:

```typescript
import { useTranslations } from "@/app/context/translation-provider";

function MyComponent() {
  const { t } = useTranslations();

  return <button>{t("common.submit")}</button>;
}
```

Add each new key to both `src/app/locales/en.json` and `src/app/locales/tr.json`,
nested, and read it with dot notation:

```json
{
  "chat": {
    "openInOdoo": "Odoo Page",
    "statusOnline": "online"
  }
}
```

## Odoo Backend Integration

Ask the backend developer before building anything that depends on the Odoo API.
They can tell you the models and fields, the parameters a call needs, the shape
of what comes back, and who is allowed to read it.

### JSON-RPC Client

`src/app/lib/odoo/jsonrpc.ts` provides `OdooClient` (authenticate, create a
session) and `OdooSessionClient` (`searchRead`, `read`, `count`, `create`,
`call`, `callController`). `src/app/lib/odoo/server.ts` holds the shared
server-side helpers: `createOdooClient`, `getOdooBaseUrl`, `requireSession`.

### Environment Variables

```bash
ODOO_JSONRPC_HOST=localhost
ODOO_JSONRPC_PORT=8069
ODOO_JSONRPC_PROTOCOL=http
ODOO_JSONRPC_DATABASE=your_database

# Optional: Odoo's websocket when it is not /websocket next to JSON-RPC
ODOO_WEBSOCKET_URL=
```

### API Route Pattern

Routes read the session from the `x-session-id` header, build a session-scoped
Odoo client, and let Odoo's record rules decide what comes back. Never take a
record id from the browser and read it with elevated rights.

```typescript
export async function GET(request: NextRequest) {
  const sessionId = request.headers.get("x-session-id");
  if (!sessionId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const session = createOdooClient().createSession(sessionId);

  try {
    const data = await session.searchRead(/* ... */);
    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json(
      { error: (error as Error).message },
      { status: 500 }
    );
  }
}
```

Routes that reach an external service rather than Odoo (the `/api/ai/*` group)
call `requireSession(request)` first.

## Responsive Design

The app runs on phones and on desktops, and both matter. Use `useResponsive()`
to branch, mobile-first Tailwind classes to style, and `useMobileNavigation()`
for the chat list toggle. Touch targets stay at 44px or larger.

```typescript
const { isMobile } = useResponsive();
```

```typescript
// mobile by default, desktop from md: up
<div className="flex-col md:flex-row">
```

## Real-Time Updates

```
Odoo bus → one websocket per session (Next.js) → one SSE stream per tab → query cache
```

Odoo publishes thread and message changes on its bus (`bus.bus`), once per
record and transaction, on the channel of the thread's backend.
`src/app/lib/realtime/odoo-bus.ts` opens one websocket to Odoo's `/websocket`
per Odoo session, with the session cookie and an `Origin` header, and
subscribes to the `whatsapp` channel; Odoo adds the channels of the user's
backends and re-checks the session on every message, so the frontend keeps no
access list. A closed session (`4001`) reaches the tabs as `session-expired`.

`/api/events` serves one stream per tab from that connection. Every event
carries the bus notification id; a tab that reconnects sends the last id it
saw and gets the events it missed from a 500-event buffer, or a `resync`
event, which reloads the cached threads, messages and unread count.

Two event types: `whatsapp/thread` (chat list fields) and `whatsapp/message`
(`created`, or `updated` for status, reaction, body or attachment changes).
Neither carries an unread count, because one event reaches every user of the
backend and unread is per user; each client counts its own and re-syncs the
total from `/api/threads/unread-count`.

`RealtimeProvider` owns the tab's stream (none for a tab blocked by the
single-tab rule). Subscribe with `useRealtime`:

```typescript
useRealtime({
  onThread: (record) => {},
  onMessage: (event, threadId, record) => {},
});
```

The bus connections live in the Next.js process, so it works for a single
instance. The websocket URL defaults to `/websocket` next to JSON-RPC; set
`ODOO_WEBSOCKET_URL` when Odoo serves it elsewhere (multi-worker Odoo serves it
on the gevent port, usually through nginx).

## Notifications

`src/app/lib/notifications.ts` owns the sound, the desktop notification and the
app badge. Route every alert through `notifyIncomingMessage` so one message
produces one sound and one notification. It stays silent for the thread the
user is reading in a visible tab, and it de-duplicates by message id.

`CurrentChatProvider` reports which thread is open through `setActiveThread`.
Permission is requested from the Settings button, never on load: Safari and
Firefox drop a request that did not come from a click.

## Theme System

Dark and light are driven by `data-theme` on the root element; Plum, Cobalt
and Verdant palettes use `data-color-scheme`. Both preferences are stored in
localStorage. The palette covers surfaces, text, borders, inputs, scrollbars
and message bubbles. Status colours keep their semantic meaning. Every
colour comes from a CSS variable defined in `src/app/globals.css`:

```typescript
className = "bg-[rgb(var(--bg-primary))]";
className = "text-[rgb(var(--text-secondary)/var(--text-secondary-opacity))]";
className = "border-[rgb(var(--border-primary)/var(--border-primary-opacity))]";
```

Hard-coded colours (`bg-black`, `text-white/50`, `border-gray-300`) do not
follow the theme. `globals.css` has the full variable list. A new colour goes
into both mode blocks and the Cobalt/Verdant overrides when palette-dependent,
as raw RGB values (or aliases to existing tokens), without the `rgb()` wrapper.
The mode blocks provide the default Plum palette.

```typescript
import { useTheme } from "@/app/hooks/use-theme";

const { theme, setTheme, toggleTheme } = useTheme();
```

## State Management

Server state (threads, messages, message search, unread count) lives in the
TanStack Query cache (`QueryProvider`); realtime events and sends patch it
through `src/app/lib/whatsapp/`. Client state lives in providers:
`AuthProvider`, `ChatsProvider`, `CurrentChatProvider`, `RealtimeProvider`,
`ContactsProvider`, `TranslationProvider`, `ThemeProvider`,
`ConnectionProvider`, `MobileNavigationProvider`, `TabSyncProvider`,
`ProfileProvider`.

Reach them through their hooks (`useAuth`, `useChats`, `useCurrentChat`,
`useRealtime`, `useTheme`, `useTranslations`), never through `useContext`
directly.

## Security Notes

- The session id travels in the `x-session-id` header, and in the query string
  for SSE and avatars, because `EventSource` and `<img>` cannot set headers.
- The browser keeps the session id in localStorage, so treat XSS as an account
  takeover, not a defacement.
- Uploads and downloads proxy through Odoo, which checks that the attachment
  belongs to a WhatsApp message the user may read.

## Code Style

- Arrow functions for components, destructured props
- No `any`
- Import order: React, Next.js, external, local
- kebab-case filenames, PascalCase components
- Console logs carry a prefix tag: `console.log("[SSE]", "...")`

## Before Committing

- Text goes through `t()`, with keys in both `en.json` and `tr.json`
- Colours use CSS variables, checked in dark and in light
- Layout checked below and above 768px
- `bun run type-check`, `bun run lint` and `bun run prettier` pass
- Anything touching Odoo models confirmed with the backend developer
