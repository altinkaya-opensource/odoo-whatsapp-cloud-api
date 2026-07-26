# Odoo WhatsApp Cloud API - Frontend

A Next.js-based frontend for managing WhatsApp conversations integrated with Odoo.

## About This Project

Most of this frontend was written with AI assistance while the developer worked on the Odoo backend.

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Icons**: Phosphor Icons
- **Backend**: Odoo JSON-RPC

## Getting Started

### Prerequisites

- Node.js 20.9 or higher
- Bun package manager
- Running Odoo backend with WhatsApp Cloud API module

### Installation

```bash
# Install dependencies
bun install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local with your Odoo configuration

# Run development server
bun run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Environment Variables

```env
ODOO_JSONRPC_HOST=localhost
ODOO_JSONRPC_PORT=8069
ODOO_JSONRPC_PROTOCOL=http
ODOO_JSONRPC_DATABASE=your_database

# Signs the webhooks Odoo sends here (openssl rand -hex 32)
ODOO_WEBHOOK_SECRET=

# Optional, for the AI reply helpers
AI_CHAT_ENABLED=false
OPENAI_BASE_URL=
OPENAI_API_KEY=
OPENAI_MODEL=
RAG_SUPPORTED_CHAT_URL=
```

## Available Scripts

- `bun run dev` - Start development server
- `bun run build` - Build for production
- `bun run start` - Start production server
- `bun run lint` - Run ESLint
- `bun run prettier` - Check code formatting
- `bun run prettier:fix` - Fix code formatting
- `bun run type-check` - Run TypeScript type checking

## Features

- Real-time message updates via Server-Sent Events (SSE)
- Multi-language support (English/Turkish)
- Responsive design (mobile and desktop)
- Contact management
- Message threading
- File attachments
- Replies to a specific message
- Desktop notifications

## Project Structure

```plaintext
src/app/
├── api/           # API routes (proxy to Odoo)
├── components/    # React components
├── context/       # Context providers
├── hooks/         # Custom React hooks
├── lib/           # Utilities and helpers
└── locales/       # Translation files
```

## Pre-commit Hooks

Pre-commit hooks run on `git commit`.

### Setup

```bash
# Install pre-commit (if not already installed)
pip install pre-commit

# Install the git hook scripts
cd frontend
pre-commit install
```

### Hooks Included

- **Prettier** - Code formatting
- **ESLint** - Linting and code quality
- **TypeScript** - Type checking
- **Basic checks** - Trailing whitespace, end of file, merge conflicts

### Manual Run

```bash
# Run all hooks on all files
pre-commit run --all-files

# Run specific hook
pre-commit run prettier --all-files
```

## Development Notes

See [CLAUDE.md](./CLAUDE.md) for the coding rules this project follows.

## Docker Deployment

```bash
docker compose up -d --build
```

## License

Part of the Odoo WhatsApp Cloud API integration. LGPL-3.
