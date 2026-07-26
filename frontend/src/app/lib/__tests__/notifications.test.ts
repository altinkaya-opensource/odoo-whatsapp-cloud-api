import { beforeEach, describe, expect, it } from "vitest";
import {
  markMessagesAsSeen,
  notifyIncomingMessage,
  setActiveThread,
} from "../notifications";

const incoming = (threadId: string, messageId: number) => ({
  threadId,
  messageId,
  title: "Ada",
  body: "Hello",
});

describe("notifyIncomingMessage", () => {
  beforeEach(() => {
    setActiveThread(null);
    // The module treats a missing document as "tab not visible".
    delete (globalThis as { document?: unknown }).document;
  });

  it("announces a message once, whichever provider reports it first", () => {
    const first = notifyIncomingMessage(incoming("7", 1));
    const second = notifyIncomingMessage(incoming("7", 1));

    expect(first).toEqual({ isNew: true, interrupted: true });
    expect(second).toEqual({ isNew: false, interrupted: false });
  });

  it("stays quiet for the thread open in a visible tab", () => {
    (globalThis as { document?: unknown }).document = {
      visibilityState: "visible",
    };
    setActiveThread("42");

    expect(notifyIncomingMessage(incoming("42", 2))).toEqual({
      isNew: true,
      interrupted: false,
    });
    // Another conversation still interrupts.
    expect(notifyIncomingMessage(incoming("43", 3))).toEqual({
      isNew: true,
      interrupted: true,
    });
  });

  it("does not re-announce messages that were already on screen", () => {
    markMessagesAsSeen("9", [10, 11]);

    expect(notifyIncomingMessage(incoming("9", 10)).isNew).toBe(false);
    expect(notifyIncomingMessage(incoming("9", 12)).isNew).toBe(true);
  });
});
