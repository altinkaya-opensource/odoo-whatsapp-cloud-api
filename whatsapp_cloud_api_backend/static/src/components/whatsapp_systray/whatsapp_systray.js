/** @odoo-module **/

import { Component, useState, onWillStart, onWillUnmount } from "@odoo/owl";
import { registry } from "@web/core/registry";
import { useService } from "@web/core/utils/hooks";
import { browser } from "@web/core/browser/browser";

export class WhatsAppSystray extends Component {
    setup() {
        this.rpc = useService("rpc");
        this.user = useService("user");
        this.notification = useService("notification");
        this.state = useState({ unreadCount: 0, hasAccess: false });

        this.busService = useService("bus_service");
        this.onBusNotification = this.onBusNotification.bind(this);

        onWillStart(async () => {
            this.state.hasAccess = await this.user.hasGroup(
                "whatsapp_cloud_api_backend.group_whatsapp_backend_user"
            );
            if (this.state.hasAccess) {
                await this.fetchUnreadCount();
                // Customer messages arrive on the bus; the server adds the
                // channels of the user's backends to this one.
                this.busService.addChannel("whatsapp");
                this.busService.addEventListener("notification", this.onBusNotification);
            }
        });

        // Reads happen in the WhatsApp frontend and are not pushed: poll for them
        this.pollInterval = browser.setInterval(() => {
            if (this.state.hasAccess) {
                this.fetchUnreadCount();
            }
        }, 120000);

        onWillUnmount(() => {
            browser.clearInterval(this.pollInterval);
            browser.clearTimeout(this.refreshTimeout);
            this.busService.removeEventListener("notification", this.onBusNotification);
        });
    }

    /**
     * Refresh the badge shortly after a customer message arrives.
     *
     * @param {CustomEvent} event bus notifications
     */
    onBusNotification({ detail: notifications }) {
        const hasIncoming = notifications.some(
            ({ type, payload }) =>
                type === "whatsapp/message" &&
                payload.event === "created" &&
                payload.message.direction === "incoming"
        );
        if (hasIncoming) {
            browser.clearTimeout(this.refreshTimeout);
            this.refreshTimeout = browser.setTimeout(() => this.fetchUnreadCount(), 1000);
        }
    }

    async fetchUnreadCount() {
        try {
            const result = await this.rpc("/whatsapp/unread_count", { for_badge: true });
            this.state.unreadCount = result.unread_count || 0;
        } catch (error) {
            console.error("Failed to fetch WhatsApp unread count:", error);
        }
    }

    async openWhatsApp() {
        try {
            const result = await this.rpc("/whatsapp/frontend/sso-url");

            if (result.error) {
                this.notification.add(result.error, {
                    type: "warning",
                    title: this.env._t("WhatsApp Integration"),
                });
                return;
            }

            if (result.url) {
                browser.open(result.url, "_blank");
            }
        } catch (error) {
            this.notification.add(
                this.env._t("Failed to open WhatsApp. Please contact your administrator."),
                {
                    type: "danger",
                    title: this.env._t("WhatsApp Integration Error"),
                }
            );
            console.error("WhatsApp SSO error:", error.message || "An error occurred");
        }
    }

}

WhatsAppSystray.template = "whatsapp_cloud_api_backend.WhatsAppSystray";

export const systrayItem = {
    Component: WhatsAppSystray,
};

registry.category("systray").add("whatsapp", systrayItem, { sequence: 50 });
