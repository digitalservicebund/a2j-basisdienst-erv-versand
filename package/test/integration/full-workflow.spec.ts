import { describe, it, inject, expect, vi, onTestFinished } from "vitest";
import amqp, { type Channel } from "amqplib";
import { sendMessage, vibiliaAdapter } from "~/send-message";
import { consumeMessages, type SendExampleEgvpMessage } from "~/index";

describe("example EGVP messages", () => {
  it("uses the versioned request and success reply types", async () => {
    const { channel, userId, clientReplyQueue, otherReplyQueue } = await setupWorkflow();
    const correlationId = globalThis.crypto.randomUUID();
    const request: SendExampleEgvpMessage = { receiver: receiverSafeId };
    const reply = await publishRequestAndWaitForReply(
      channel,
      clientReplyQueue,
      {
        type: "de.justiz.basisdienst.erv.send-egvp-example-message.v1",
        userId,
        correlationId,
        payload: request,
      },
    );

    expect(reply.properties).toMatchObject({
      correlationId,
      type: "de.justiz.basisdienst.erv.egvp-message-sent.v1",
      headers: { userId },
    });
    expect(JSON.parse(reply.content.toString())).toEqual({
      messageId: "test-message-id",
    });
    expect(await channel.get(otherReplyQueue, { noAck: true })).toBe(false);
  });
});

describe("regular EGVP messages", () => {
  it("uses the versioned success reply type for versioned requests", async () => {
    const { channel, userId, clientReplyQueue, otherReplyQueue } = await setupWorkflow();
    const correlationId = globalThis.crypto.randomUUID();
    const reply = await publishRequestAndWaitForReply(
      channel,
      clientReplyQueue,
      {
        type: "de.justiz.basisdienst.erv.send-egvp-message.v1",
        userId,
        correlationId,
        payload: sendEgvpPayload,
      },
    );

    expect(reply.properties).toMatchObject({
      correlationId,
      type: "de.justiz.basisdienst.erv.egvp-message-sent.v1",
      headers: { userId },
    });
    expect(JSON.parse(reply.content.toString())).toEqual({
      messageId: "test-message-id",
    });
    expect(await channel.get(otherReplyQueue, { noAck: true })).toBe(false);
  });

  it("preserves the legacy reply type for legacy requests", async () => {
    const { channel, userId, clientReplyQueue, otherReplyQueue } =
      await setupWorkflow();
    const correlationId = globalThis.crypto.randomUUID();
    const reply = await publishRequestAndWaitForReply(
      channel,
      clientReplyQueue,
      {
        type: "send-egvp-message",
        userId,
        correlationId,
        payload: sendEgvpPayload,
      },
    );

    expect(reply.properties).toMatchObject({
      correlationId,
      type: "egvp-message-sent",
      headers: { userId },
    });
    expect(JSON.parse(reply.content.toString())).toEqual({
      messageId: "test-message-id",
    });
    expect(await channel.get(otherReplyQueue, { noAck: true })).toBe(false);
  });

  it("publishes an AsyncAPI failure reply when sending fails", async () => {
    const { channel, userId, clientReplyQueue, otherReplyQueue } =
      await setupWorkflow();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(sendMessage).mockRejectedValueOnce(new Error("Vibilia failed"));
    const correlationId = globalThis.crypto.randomUUID();
    const reply = await publishRequestAndWaitForReply(
      channel,
      clientReplyQueue,
      {
        type: "de.justiz.basisdienst.erv.send-egvp-message.v1",
        userId,
        correlationId,
        payload: sendEgvpPayload,
      },
    );

    expect(reply.properties).toMatchObject({
      correlationId,
      contentType: "application/problem+json",
      type: "de.justiz.basisdienst.erv.send-egvp-message-failed.v1",
      headers: { userId },
    });
    expect(JSON.parse(reply.content.toString())).toEqual({
      type: "https://schemas.service.justiz.de/basisdienst/erv/problems/unknown-problem",
      title: "Unknown Problem",
      detail: "The message could not be sent due to an unexpected error.",
    });
    expect(await channel.get(otherReplyQueue, { noAck: true })).toBe(false);
  });
});

vi.mock("~/send-message", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/send-message")>()),
  sendMessage: vi.fn().mockResolvedValue("test-message-id"),
}));

const receiverSafeId = "DE.Justiz.71051095-c471-46e3-1760-56d2229c3bb2.a740";
const sendEgvpPayload = {
  receiver: receiverSafeId,
  xjustizMessage: {
    content: Buffer.from("<xjustiz/>").toString("base64"),
  },
};

async function setupWorkflow() {
  const amqpUrl = inject("amqpUrl");
  const connection = await amqp.connect(amqpUrl);
  connection.on("error", () => {});

  const channel = await connection.createChannel();
  channel.on("error", () => {});

  onTestFinished(async () => {
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
  );

  await channel.assertExchange("replies", "direct");
  await channel.assertQueue(clientReplyQueue, { autoDelete: true });
  await channel.assertQueue(otherReplyQueue, { autoDelete: true });
  await channel.bindQueue(clientReplyQueue, "replies", `replies.${userId}`);
  await channel.bindQueue(
    otherReplyQueue,
    "replies",
    `replies.${otherUserId}`,
  );

  return { channel, userId, clientReplyQueue, otherReplyQueue };
}

async function waitForReply(channel: Channel, queue: string) {
  return await vi.waitFor(async () => {
    const message = await channel.get(queue, { noAck: true });
    if (message === false) {
      throw new Error("Reply message not yet available");
    }
    return message;
  });
}

async function publishRequestAndWaitForReply(
  channel: Channel,
  replyQueue: string,
  request: {
    type: string;
    userId: string;
    correlationId: string;
    payload: unknown;
  },
) {
  channel.publish(
    "requests",
    "requests",
    Buffer.from(JSON.stringify(request.payload)),
    {
      type: request.type,
      userId: request.userId,
      correlationId: request.correlationId,
    },
  );

  return waitForReply(channel, replyQueue);
}
