from odoo.tests.common import TransactionCase


class TestWhatsAppTemplateLanguage(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.language = cls.env.ref("base.lang_tr")
        cls.language.active = True

        cls.product = cls.env["product.template"].create({"name": "English name"})
        cls.product.with_context(lang=cls.language.code).name = "Turkish name"

        cls.template = cls.env["whatsapp.template"].create(
            {
                "name": "translated_product",
                "waba_id": "test-waba",
                "language": "tr",
                "language_id": cls.language.id,
                "model_id": cls.env["ir.model"]._get("product.template").id,
                "components": [{"type": "BODY", "text": "Product: {{1}}"}],
            }
        )
        cls.env["whatsapp.template.variable"].create(
            {
                "template_id": cls.template.id,
                "variable_position": 1,
                "component_type": "body",
                "value_type": "field",
                "field_id": cls.env["ir.model.fields"]
                ._get("product.template", "name")
                .id,
            }
        )

    def test_preview_uses_template_language(self):
        preview = self.template.with_context(lang="en_US").render_message_preview(
            self.product
        )

        self.assertEqual(preview, "Product: Turkish name")

    def test_payload_uses_template_language(self):
        payload = self.template.with_context(lang="en_US").build_payload_for_record(
            self.product
        )

        self.assertEqual(
            payload["components"],
            [
                {
                    "type": "body",
                    "parameters": [{"type": "text", "text": "Turkish name"}],
                }
            ],
        )

    def test_python_code_receives_template_language_context(self):
        self.template.variable_ids.write(
            {
                "value_type": "code",
                "field_id": False,
                "python_code": "result = env.context.get('lang')",
            }
        )

        preview = self.template.with_context(lang="en_US").render_message_preview(
            self.product
        )

        self.assertEqual(preview, "Product: tr_TR")
