import json
from urllib.parse import parse_qs, urlparse

import requests

from odoo.tests import HttpCase, new_test_user, tagged


@tagged("post_install", "-at_install")
class TestWhatsAppFrontendSso(HttpCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.agent = new_test_user(
            cls.env,
            login="whatsapp_sso_agent",
            password="Sso-Test-12345",
            groups="base.group_user,whatsapp_cloud_api_backend.group_whatsapp_backend_user",
        )
        cls.env["whatsapp.backend"].create(
            {
                "name": "SSO test",
                "api_token": "sso-test-token",
                "phone_number_id": "sso-test",
                "frontend_webhook_url": "https://wa.example.com",
                "user_ids": [(6, 0, cls.agent.ids)],
            }
        )

    def _rpc(self, path, params=None, session_id=None):
        """Call a JSON route, as the test browser or with another session."""
        payload = json.dumps(
            {"jsonrpc": "2.0", "method": "call", "params": params or {}}
        )
        headers = {"Content-Type": "application/json"}
        if session_id is None:
            response = self.url_open(path, data=payload, headers=headers)
        else:
            # The frontend's server: no cookie of the browser's session
            response = requests.post(
                f"{self.base_url()}{path}",
                data=payload,
                headers=headers,
                cookies={"session_id": session_id} if session_id else {},
                timeout=30,
            )
        return response.json()["result"]

    def test_link_signs_in_once_with_a_new_session(self):
        self.authenticate("whatsapp_sso_agent", "Sso-Test-12345")
        url = self._rpc("/whatsapp/frontend/sso-url")["url"]

        self.assertTrue(
            url.startswith("https://wa.example.com/api/auth/sso-login?code=")
        )
        self.assertNotIn(self.session.sid, url)
        code = parse_qs(urlparse(url).query)["code"][0]
        Sso = self.env["whatsapp.frontend.sso"].sudo()
        self.assertFalse(Sso.search([("code_hash", "=", code)]), "stored in clear")

        result = self._rpc("/whatsapp/frontend/sso/exchange", {"code": code}, "")
        session_id = result["session_id"]
        self.assertNotEqual(session_id, self.session.sid)
        info = self._rpc("/web/session/get_session_info", session_id=session_id)
        self.assertEqual(info["uid"], self.agent.id)

        self.assertEqual(
            self._rpc("/whatsapp/frontend/sso/exchange", {"code": code}, ""),
            {"error": "invalid_code"},
        )

    def test_expired_or_unknown_code_is_refused(self):
        Sso = self.env["whatsapp.frontend.sso"]
        code = Sso._issue_code(self.agent)
        Sso.flush_model()
        self.env.cr.execute(
            "UPDATE whatsapp_frontend_sso"
            " SET create_date = create_date - interval '2 minutes'"
        )
        self.assertFalse(Sso._redeem(code))
        self.assertFalse(Sso._redeem("not-a-code"))
        self.assertFalse(Sso._redeem(None))
