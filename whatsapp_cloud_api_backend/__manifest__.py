# Copyright 2025 Ahmet Yiğit Budak (https://github.com/yibudak)
# License AGPL-3.0 or later (http://www.gnu.org/licenses/agpl)
{
    "name": "WhatsApp Cloud API Backend",
    "summary": "WhatsApp Cloud API & Odoo Integration Backend",
    "version": "16.0.1.0.0",
    "author": "Ahmet Yiğit Budak, Erol Develi, Altinkaya Enclosures",
    "website": "https://github.com/altinkaya-opensource/odoo-whatsapp-cloud-api",
    "license": "LGPL-3",
    "category": "Tools",
    "depends": ["base", "mail", "queue_job", "web", "account"],
    "external_dependencies": {"python": ["requests", "phonenumbers"]},
    "data": [
        "security/whatsapp_security.xml",
        "security/ir.model.access.csv",
        "wizard/whatsapp_composer_views.xml",
        "views/whatsapp_backend_views.xml",
        "views/whatsapp_message_views.xml",
        "views/whatsapp_thread_views.xml",
        "views/whatsapp_template_views.xml",
        "views/whatsapp_chatbot_views.xml",
        "views/res_partner_views.xml",
        "views/whatsapp_message_report_views.xml",
    ],
    "assets": {
        "web.assets_backend": [
            "whatsapp_cloud_api_backend/static/src/components/whatsapp_systray/whatsapp_systray.js",
            "whatsapp_cloud_api_backend/static/src/components/whatsapp_systray/whatsapp_systray.xml",
            "whatsapp_cloud_api_backend/static/src/components/whatsapp_systray/whatsapp_systray.scss",
        ],
    },
    "installable": True,
}
