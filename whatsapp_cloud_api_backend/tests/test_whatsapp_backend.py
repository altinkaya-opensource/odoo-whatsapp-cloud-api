from odoo.exceptions import ValidationError
from odoo.tests.common import TransactionCase


class TestWhatsAppBackend(TransactionCase):
    def _create_backend(self, name, main_backend=False):
        return self.env["whatsapp.backend"].create(
            {
                "name": name,
                "api_token": "backend-test-token",
                "phone_number_id": f"backend-test-{name}",
                "main_backend": main_backend,
            }
        )

    def test_many_regular_backends(self):
        backends = self._create_backend("one") | self._create_backend("two")
        self.assertEqual(len(backends), 2)

    def test_single_main_backend(self):
        self.env["whatsapp.backend"].search([]).write({"main_backend": False})
        self._create_backend("main", main_backend=True)
        with self.assertRaises(ValidationError):
            self._create_backend("second main", main_backend=True)
