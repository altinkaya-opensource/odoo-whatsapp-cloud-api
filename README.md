# Odoo WhatsApp Cloud API

WhatsApp Business Cloud API inside Odoo, with a Next.js chat interface for the people answering messages.

You can:

- Send and receive WhatsApp messages from Odoo
- Answer conversations in a dedicated web interface
- Link WhatsApp threads to Odoo partners
- Send and receive images, videos, documents and audio
- See sent, delivered and read status
- Reply to a specific message

## Project Structure

- **whatsapp_cloud_api_backend/** - Odoo module (Python)
- **frontend/** - Next.js web application

## Getting Started

### Backend (Odoo Module)

1. Copy `whatsapp_cloud_api_backend/` to your Odoo addons directory
2. Update the addons list and install the module
3. Configure your WhatsApp Business Cloud API credentials in Odoo

### Frontend (Next.js Application)

See [frontend/README.md](./frontend/README.md) for detailed setup instructions.

## Requirements

- **Backend**: Odoo 16.0+, Python 3.8+
- **Frontend**: Node.js 18+, Yarn

## License

LGPL-3

## Authors

- Ahmet Yiğit Budak - [Altinkaya Enclosures](https://github.com/altinkaya-opensource)
- Erol Develi - [GitHub](https://github.com/erlinberg)
