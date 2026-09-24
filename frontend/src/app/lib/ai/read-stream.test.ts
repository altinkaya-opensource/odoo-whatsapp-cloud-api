import { describe, expect, it, vi } from "vitest";
import { readAiStream } from "./read-stream";

const streamOf = (...chunks: string[]) =>
  new Response(
    new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
        controller.close();
      },
    })
  );

describe("readAiStream", () => {
  it("joins the pieces, even when an event is cut between chunks", async () => {
    const onText = vi.fn();
    const text = await readAiStream(
      streamOf(
        'data: {"content":"Mer"}\n\ndata: {"con',
        'tent":"haba"}\n\n',
        "data: [DONE]\n\n",
        'data: {"content":" ignored"}\n\n'
      ),
      onText
    );
    expect(text).toBe("Merhaba");
    expect(onText.mock.calls.map(([value]) => value)).toEqual([
      "Mer",
      "Merhaba",
    ]);
  });

  it("fails on an error answer", async () => {
    await expect(
      readAiStream(new Response("{}", { status: 429 }), vi.fn())
    ).rejects.toThrow("429");
  });
});
