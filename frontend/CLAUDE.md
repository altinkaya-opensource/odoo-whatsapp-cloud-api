# CLAUDE.md - Odoo WhatsApp Cloud API Frontend

## Development Environment

- **Language**: TypeScript
- **Framework**: Next.js 15 (App Router, Turbopack in dev)
- **Styling**: Tailwind CSS
- **Icons**: Phosphor Icons (`@phosphor-icons/react`)
- **State**: React Context
- **Real-time**: Server-Sent Events fed by Odoo webhooks
- **Backend**: Odoo JSON-RPC
- **Package manager**: yarn. Do not use npm or pnpm.

## Project Structure

- `src/app/api/` - API routes that proxy to Odoo
- `src/app/components/` - React components
- `src/app/context/` - Context providers
- `src/app/hooks/` - Custom hooks
- `src/app/lib/` - Odoo client, notifications, event broadcaster, session cache
- `src/app/locales/` - `en.json` and `tr.json`
- `public/` - Static assets

## Commands

- `yarn dev` - dev server on port 3000
- `yarn build` / `yarn start` - production build and serve
- `yarn lint`, `yarn type-check`, `yarn prettier`, `yarn prettier:fix`
- `yarn test` - vitest
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

# Signs the webhooks Odoo sends here (openssl rand -hex 32)
ODOO_WEBHOOK_SECRET=
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
Odoo → webhook → Next.js → EventBroadcaster → SSE → browser
```

Odoo fires a webhook whenever a thread or message record changes. The endpoint
at `/api/webhooks/whatsapp` checks the HMAC-SHA256 signature against
`ODOO_WEBHOOK_SECRET` and hands the payload to the broadcaster, which delivers
it only to the SSE connections whose session may read that backend. A payload
without `data.backend_id` gets rejected: without it there is no way to tell who
is allowed to see the event.

Three event types travel this path: `thread.created`, `thread.updated` and
`message.created`. Thread events carry no unread count, because one payload
reaches every user of the backend and unread is per user. Each client keeps its
own count and re-syncs the total from `/api/threads/unread-count`.

`/api/events` sends a heartbeat every 30 seconds and touches the session cache
so an open tab keeps its session alive. Polling covers what webhooks miss: the
thread list every 10 minutes, messages in the open thread on the same interval.

```typescript
const { isConnected } = useSSE(
  {
    onThreadsUpdate: (threads) => {},
    onMessagesUpdate: (messages, threadId) => {},
    onError: (error) => {},
    onReconnect: () => {},
  },
  { threadId: "123", enabled: !!sessionId }
);
```

`src/app/lib/events/broadcaster.ts` is an in-memory pub/sub, so it works for a
single instance. Horizontal scaling needs Redis pub/sub in its place.

The Odoo side needs the frontend webhook URL configured on the backend record:
`https://your-domain.com/api/webhooks/whatsapp`.

## Notifications

`src/app/lib/notifications.ts` owns the sound, the desktop notification and the
app badge. Route every alert through `notifyIncomingMessage` so one message
produces one sound and one notification. It stays silent for the thread the
user is reading in a visible tab, and it de-duplicates by message id.

`CurrentChatProvider` reports which thread is open through `setActiveThread`.
Permission is requested from the Settings button, never on load: Safari and
Firefox drop a request that did not come from a click.

## Theme System

Dark and light, stored in localStorage, driven by `data-theme` on the root
element. Every colour comes from a CSS variable defined in
`src/app/globals.css`, so it follows the theme:

```typescript
className = "bg-[rgb(var(--bg-primary))]";
className = "text-[rgb(var(--text-secondary)/var(--text-secondary-opacity))]";
className = "border-[rgb(var(--border-primary)/var(--border-primary-opacity))]";
```

Hard-coded colours (`bg-black`, `text-white/50`, `border-gray-300`) do not
follow the theme. `globals.css` has the full variable list. A new colour goes
into both the `:root[data-theme="dark"]` and `:root[data-theme="light"]` blocks
as raw RGB values, without the `rgb()` wrapper.

```typescript
import { useTheme } from "@/app/hooks/use-theme";

const { theme, setTheme, toggleTheme } = useTheme();
```

## State Management

Providers: `AuthProvider`, `ChatsProvider`, `CurrentChatProvider`,
`ContactsProvider`, `TranslationProvider`, `ThemeProvider`, `ConnectionProvider`,
`MobileNavigationProvider`, `TabSyncProvider`, `ProfileProvider`.

Reach them through their hooks (`useAuth`, `useChats`, `useCurrentChat`,
`useTheme`, `useTranslations`), never through `useContext` directly.

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
- `yarn type-check`, `yarn lint` and `yarn prettier` pass
- Anything touching Odoo models confirmed with the backend developer
