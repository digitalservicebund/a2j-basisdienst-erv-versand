import { describe, it, inject, expect, vi, onTestFinished } from "vitest";
import amqp from "amqplib";
import { vibiliaAdapter } from "~/send-message";
import { consumeMessages, type SendExampleEgvpMessage } from "~/index";

vi.mock("~/send-message", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/send-message")>()),
  sendMessage: vi.fn().mockResolvedValue("test-message-id"),
}));

describe("full workflow", () => {
  it("routes replies through the replies direct exchange by userId", async () => {
    const amqpUrl = inject("amqpUrl");
    const connection = await amqp.connect(amqpUrl);
    connection.on("error", () => {});

    const channel = await connection.createChannel();
    channel.on("error", () => {});

    const abortController = new AbortController();
    onTestFinished(async () => {
      abortController.abort();
      await connection.close().catch(() => {});
    });

    const userId = decodeURIComponent(new URL(amqpUrl).username || "guest");
    const otherUserId = `${userId}-other`;
    const runId = globalThis.crypto.randomUUID();
    const clientReplyQueue = `replies.${userId}.${runId}`;
    const otherReplyQueue = `replies.${otherUserId}.${runId}`;

    const vibilia = vibiliaAdapter(
      new URL("http://localhost:8080"),
      "sender-safe-id",
      "password",
    );

    await consumeMessages(
      vibilia,
      channel,
      {
        requestsExchange: "requests",
        requestsQueue: "requests",
        repliesExchange: "replies",
      },
      abortController.signal,
    );

    await channel.assertExchange("replies", "direct");
    await channel.assertQueue(clientReplyQueue, { autoDelete: true });
    await channel.assertQueue(otherReplyQueue, { autoDelete: true });
    await channel.bindQueue(clientReplyQueue, "replies", userId);
    await channel.bindQueue(otherReplyQueue, "replies", otherUserId);

    const correlationId = globalThis.crypto.randomUUID();
    const request: SendExampleEgvpMessage = { receiver: "receiver-safe-id" };

    channel.publish(
      "requests",
      "requests",
      Buffer.from(JSON.stringify(request)),
      {
        type: "send-example-egvp-message",
        userId,
        correlationId,
      },
    );

    const reply = await vi.waitFor(async () => {
      const message = await channel.get(clientReplyQueue, { noAck: true });
      if (message === false) {
        throw new Error("Reply message not yet available");
      }
      return message;
    });

    expect(reply.properties).toMatchObject({
      correlationId,
      type: "example-egvp-message-sent",
      headers: { userId },
    });
    expect(JSON.parse(reply.content.toString())).toEqual({
      messageId: "test-message-id",
    });
    expect(await channel.get(otherReplyQueue, { noAck: true })).toBe(false);
  });
});
