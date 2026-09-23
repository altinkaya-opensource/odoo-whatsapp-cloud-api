# Copyright (C) 2026 Altinkaya Enclosures
# License LGPL-3.0 or later (http://www.gnu.org/licenses/lgpl-3.0.html)
"""Push thread and message changes to the frontend through the Odoo bus.

Changes are collected per transaction and sent once per record when it
commits, with the final state: a thread written five times by the chatbot
produces one notification. Notifications go to the backend's channel, which
only its members' frontend sessions subscribe to (see ir.websocket).
"""

PENDING_KEY = "whatsapp.frontend.pending"


def queue_frontend_notification(records, event):
    """Send these records to the frontend when the transaction commits."""
    if not records:
        return
    cr = records.env.cr
    pending = cr.precommit.data.get(PENDING_KEY)
    if pending is None:
        pending = cr.precommit.data[PENDING_KEY] = {}
        env = records.env(su=True)
        cr.precommit.add(lambda: _send_pending(env, pending))
    for record in records:
        key = (record._name, record.id)
        # A message created and updated in one transaction is still new
        if pending.get(key) != "created":
            pending[key] = event


def _send_pending(env, pending):
    ids_by_model = {}
    for (model, record_id), _event in pending.items():
        ids_by_model.setdefault(model, []).append(record_id)
    notifications = []
    threads = env["whatsapp.thread"].browse(ids_by_model.get("whatsapp.thread", []))
    for thread in threads.exists():
        notifications.append(
            (thread.backend_id, "whatsapp/thread", thread._frontend_payload())
        )
    messages = env["whatsapp.message"].browse(ids_by_model.get("whatsapp.message", []))
    for message in messages.exists():
        notifications.append(
            (
                message.backend_id,
                "whatsapp/message",
                {
                    "event": pending[(message._name, message.id)],
                    "thread_id": message.thread_id.id,
                    "message": message._frontend_payload(),
                },
            )
        )
    if notifications:
        env["bus.bus"]._sendmany(notifications)
