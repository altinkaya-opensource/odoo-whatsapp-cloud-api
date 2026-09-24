import { describe, expect, it } from "vitest";
import { ApiError, userErrorMessage } from "./api-client";

describe("userErrorMessage", () => {
  it("shows Odoo's own refusal, which is in the user's language", () => {
    const refusal = new ApiError(400, "Şablon bulunamadı.");
    expect(userErrorMessage(refusal, "Mesaj gönderilemedi")).toBe(
      "Şablon bulunamadı."
    );
  });

  it("falls back to the translated text for anything else", () => {
    for (const error of [
      new ApiError(500, "Failed to send message via Odoo"),
      new ApiError(504, "Failed to send message via Odoo"),
      new TypeError("fetch failed"),
    ]) {
      expect(userErrorMessage(error, "Mesaj gönderilemedi")).toBe(
        "Mesaj gönderilemedi"
      );
    }
  });
});
