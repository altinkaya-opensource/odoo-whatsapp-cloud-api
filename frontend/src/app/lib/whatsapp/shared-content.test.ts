import { describe, expect, it } from "vitest";
import {
  captionOf,
  extractLinks,
  groupByMonth,
  isSharedIn,
} from "./shared-content";

const attachment = (mimetype: string) => ({
  id: 1,
  name: "file",
  mimetype,
  url: "/whatsapp/attachment/download/1",
  file_size: 10,
});

describe("extractLinks", () => {
  it("reads the markdown links templates send, with their label", () => {
    expect(
      extractLinks("Kargonuz yolda.\n\n[Kargo Takip](https://6sn.de/a5m3e)")
    ).toEqual([{ url: "https://6sn.de/a5m3e", label: "Kargo Takip" }]);
  });

  it("reads bare addresses without the punctuation around them", () => {
    expect(
      extractLinks(
        "Ürün: https://www.altinkaya.com/tr/products/al-084?variant=16446. " +
          "Katalog (www.altinkaya.com/katalog) ve *https://solidshell.co*"
      ).map((link) => link.url)
    ).toEqual([
      "https://www.altinkaya.com/tr/products/al-084?variant=16446",
      "https://www.altinkaya.com/katalog",
      "https://solidshell.co/",
    ]);
  });

  it("keeps a bracket that belongs to the address", () => {
    expect(
      extractLinks("https://en.wikipedia.org/wiki/Enclosure_(electrical)")
    ).toEqual([
      {
        url: "https://en.wikipedia.org/wiki/Enclosure_(electrical)",
        label: null,
      },
    ]);
  });

  it("lists a repeated link once and ignores other schemes", () => {
    expect(
      extractLinks(
        "https://a.test/x https://a.test/x [bad](javascript:alert(1)) ftp://b.test"
      )
    ).toEqual([{ url: "https://a.test/x", label: null }]);
  });

  it("finds nothing in plain text", () => {
    expect(extractLinks("https olarak gönderin")).toEqual([]);
  });
});

describe("isSharedIn", () => {
  it("splits attachments into media and files like the server", () => {
    const photo = { attachment: attachment("image/jpeg") };
    const video = { attachment: attachment("video/mp4") };
    const pdf = { attachment: attachment("application/pdf") };
    const voice = { attachment: attachment("audio/ogg; codecs=opus") };
    expect(isSharedIn("media", photo)).toBe(true);
    expect(isSharedIn("media", video)).toBe(true);
    expect(isSharedIn("media", pdf)).toBe(false);
    expect(isSharedIn("files", pdf)).toBe(true);
    expect(isSharedIn("files", voice)).toBe(true);
    expect(isSharedIn("files", photo)).toBe(false);
    expect(isSharedIn("files", { attachment: null })).toBe(false);
  });

  it("puts a message in links only when its text has one", () => {
    expect(isSharedIn("links", { body: "bakın: www.altinkaya.com" })).toBe(
      true
    );
    expect(isSharedIn("links", { body: false })).toBe(false);
  });
});

describe("captionOf", () => {
  const media = (message: string) => ({
    contactId: "1",
    message,
    timestamp: 0,
    isSentFromUser: false,
    attachment: { ...attachment("image/jpeg"), name: "CARİ BİLGİSİ.jpg" },
  });

  it("keeps what the sender wrote", () => {
    expect(captionOf(media("Ödeme yapıldı\n"))).toBe("Ödeme yapıldı");
  });

  it("drops the file name and type placeholders stored as the text", () => {
    expect(captionOf(media("CARİ BİLGİSİ.jpg"))).toBeNull();
    expect(captionOf(media("Image"))).toBeNull();
    expect(captionOf(media("Görsel"))).toBeNull();
    expect(captionOf(media(""))).toBeNull();
  });
});

describe("groupByMonth", () => {
  it("groups consecutive items of the same month", () => {
    const items = [
      new Date(2026, 8, 20).getTime(),
      new Date(2026, 8, 1).getTime(),
      new Date(2026, 7, 31).getTime(),
    ];
    expect(
      groupByMonth(items, (item) => item).map((group) => group.items.length)
    ).toEqual([2, 1]);
  });

  it("keeps a month that comes back apart, with its own key", () => {
    const september = new Date(2026, 8, 1).getTime();
    const august = new Date(2026, 7, 31).getTime();
    const groups = groupByMonth([september, august, september], (item) => item);
    expect(groups.map((group) => group.items.length)).toEqual([1, 1, 1]);
    expect(new Set(groups.map((group) => group.key)).size).toBe(3);
  });
});
