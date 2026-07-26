# Frontend Production Deployment

Deploying the Odoo WhatsApp Cloud API frontend with Docker.

## Prerequisites

- Docker installed (version 20.10 or higher)
- Docker Compose installed (version 2.0 or higher)
- Access to your production Odoo instance

## Quick Start

### 1. Configure Production Environment

Copy the example environment file and update it with your production values:

```bash
cp .env.production.example .env.production
```

Edit `.env.production` and update the following values:

```env
ODOO_JSONRPC_PROTOCOL=https
ODOO_JSONRPC_HOST=your-odoo-domain.com
ODOO_JSONRPC_PORT=443
ODOO_JSONRPC_DATABASE=your_production_database
```

### 2. Build and Run with Docker Compose

```bash
# Build and start the container
docker compose up -d

# View logs
docker compose logs -f frontend

# Stop the container
docker compose down
```

The application will be available at `http://localhost:3000`

### 3. Alternative: Manual Docker Build

If you prefer to build and run manually:

```bash
# Build the image
docker build -t odoo-whatsapp-frontend .

# Run the container
docker run -d \
  --name odoo-whatsapp-frontend \
  -p 3000:3000 \
  --env-file .env.production \
  odoo-whatsapp-frontend
```

## Production Deployment Options

### Option 1: Behind a Reverse Proxy (Recommended)

Use Nginx or Traefik as a reverse proxy with SSL/TLS:

**Nginx example:**

```nginx
server {
    listen 80;
    server_name whatsapp.yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name whatsapp.yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Option 2: Direct Deployment with Custom Port

Modify `docker-compose.yml` to expose a different port:

```yaml
ports:
  - "8080:3000"
```

## Docker Commands Reference

```bash
# View running containers
docker ps

# View all containers (including stopped)
docker ps -a

# View container logs
docker logs odoo-whatsapp-frontend

# Follow logs in real-time
docker logs -f odoo-whatsapp-frontend

# Restart container
docker restart odoo-whatsapp-frontend

# Stop container
docker stop odoo-whatsapp-frontend

# Remove container
docker rm odoo-whatsapp-frontend

# Remove image
docker rmi odoo-whatsapp-frontend

# Rebuild without cache
docker compose build --no-cache
docker compose up -d
```

## Updating the Application

When you have new code changes:

```bash
# Pull latest changes
git pull

# Rebuild and restart
docker compose down
docker compose build --no-cache
docker compose up -d
```

## Environment Variables

| Variable                 | Description                                          | Example                     |
| ------------------------ | ---------------------------------------------------- | --------------------------- |
| `ODOO_JSONRPC_PROTOCOL`  | Protocol for Odoo connection                         | `https` or `http`           |
| `ODOO_JSONRPC_HOST`      | Odoo server hostname/IP                              | `odoo.example.com`          |
| `ODOO_JSONRPC_PORT`      | Odoo server port                                     | `443`, `8069`               |
| `ODOO_JSONRPC_DATABASE`  | Odoo database name                                   | `production_db`             |
| `ODOO_WEBHOOK_SECRET`    | Signs webhooks from Odoo; must match the backend     | `openssl rand -hex 32`      |
| `AI_CHAT_ENABLED`        | Turns the AI reply helpers on                        | `false`                     |
| `OPENAI_BASE_URL`        | OpenAI-compatible endpoint, when AI is on            | `https://api.openai.com/v1` |
| `OPENAI_API_KEY`         | Key for that endpoint                                |                             |
| `OPENAI_MODEL`           | Model name, defaults to `openai/gpt-4o`              |                             |
| `RAG_SUPPORTED_CHAT_URL` | RAG service for suggested replies; empty disables it |                             |

Without `ODOO_WEBHOOK_SECRET` the webhook endpoint returns 500 and no message
reaches the browser in real time.

## Health Check

The container includes a health check that runs every 30 seconds:

```bash
# Check container health
docker inspect --format='{{.State.Health.Status}}' odoo-whatsapp-frontend
```

## Troubleshooting

### Container won't start

```bash
# Check logs for errors
docker logs odoo-whatsapp-frontend

# Check if port 3000 is already in use
lsof -i :3000

# Verify environment variables
docker exec odoo-whatsapp-frontend env | grep ODOO
```

### Cannot connect to Odoo

1. Verify Odoo is accessible from the container
2. Check firewall rules
3. Verify environment variables are correct
4. Check Odoo logs for authentication errors

### Build fails

```bash
# Clean Docker cache and rebuild
docker system prune -a
docker compose build --no-cache
```

## Security

- Keep `.env.production` out of version control; it holds the Odoo credentials
  and the webhook secret.
- Terminate TLS at the reverse proxy. Session ids travel in request headers and
  in the SSE query string.
- Generate a fresh `ODOO_WEBHOOK_SECRET` per environment and set the same value
  on the WhatsApp backend record in Odoo.

## Backup

Back up `.env.production` somewhere outside version control. Everything else
lives in the image.
