import { describe, expect, it, vi } from "vitest";
import { getThreadRecipient } from "./server";
import type { OdooSessionClient } from "./jsonrpc";

const sessionReading = (records: unknown[]) =>
  ({
    searchRead: vi.fn().mockResolvedValue(records),
  }) as unknown as OdooSessionClient;

describe("getThreadRecipient", () => {
  it("sends to the thread's phone number", async () => {
    const session = sessionReading([
      { phone_number: "905550000001", bsuid: "TR.1", backend_id: [2, "Main"] },
    ]);

    expect(await getThreadRecipient(session, 7)).toEqual({
      phoneNumber: "905550000001",
      backendId: 2,
    });
  });

  it("sends to the BSUID of a customer who hides their number", async () => {
    const session = sessionReading([
      {
        phone_number: false,
        bsuid: "TR.1809375520086763",
        backend_id: [2, "Main"],
      },
    ]);

    expect(await getThreadRecipient(session, 7)).toEqual({
      phoneNumber: "TR.1809375520086763",
      backendId: 2,
    });
  });

  it("finds no recipient for a thread the user cannot read", async () => {
    expect(await getThreadRecipient(sessionReading([]), 7)).toBeNull();
  });
});
