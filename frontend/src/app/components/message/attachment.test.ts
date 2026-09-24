import { describe, expect, it } from "vitest";
import { attachmentDownloadUrl } from "./attachment";

const attachment = (url: string) => ({
  id: 1,
  name: "photo.jpg",
  mimetype: "image/jpeg",
  url,
  file_size: 10,
});

describe("attachmentDownloadUrl", () => {
  it("reads a saved attachment through the proxy", () => {
    expect(
      attachmentDownloadUrl(
        attachment("https://odoo.test/whatsapp/attachment/download/7")
      )
    ).toBe(
      "/api/attachments/download?url=https%3A%2F%2Fodoo.test%2Fwhatsapp%2Fattachment%2Fdownload%2F7"
    );
  });

  it("shows a photo being sent from the browser's copy", () => {
    const local = "blob:http://localhost:3000/5f1c0a7e";
    expect(attachmentDownloadUrl(attachment(local))).toBe(local);
  });
});
