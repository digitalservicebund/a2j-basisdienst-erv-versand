import { describe, it, inject, expect } from "vitest";
import { vibiliaAdapter } from "~/send-example-message";
import amqp, { type Channel, type Message } from "amqplib";
import {
  consumeMessages,
  type InitiateTransferMessage,
  type TransferSuccessfulMessage,
} from "~/index";

describe("full workflow", () => {
  it("should work please", async ({ signal }) => {
    const connection = await amqp.connect(inject("amqpUrl"));
    const channel = await connection.createChannel();
    const requestsQueueName = "requests";
    const responsesQueueName = "responses";
    channel.assertQueue(requestsQueueName);
    channel.assertQueue(responsesQueueName);

    const vibilia = vibiliaAdapter(
      new URL("http://localhost:8080"),
      process.env["SENDER_SAFE_ID"]!,
      process.env["SENDER_MESSAGE_BOX_PASSWORD"]!,
    );

    consumeMessages(
      vibilia,
      channel,
      {
        requests: requestsQueueName,
        responses: responsesQueueName,
      },
      signal,
    );

    const request: InitiateTransferMessage = {
      receiver: process.env["RECEIVER_SAFE_ID"]!,
    };

    channel.sendToQueue(
      requestsQueueName,
      Buffer.from(JSON.stringify(request)),
    );

    const responseMessage = await waitForNextMessage(
      channel,
      responsesQueueName,
    );
    const response = parseMessage(responseMessage);

    expect(response.messageId).toBeDefined();
  });
});

function parseMessage(message: Message | null): TransferSuccessfulMessage {
  const parsedContent = JSON.parse(message?.content.toString() ?? "");

  if (
    typeof parsedContent === "object" &&
    "messageId" in parsedContent &&
    typeof parsedContent.messageId === "string"
  ) {
    return { messageId: parsedContent.messageId };
  } else {
    console.error("broken message", message?.content.toString());
    throw new Error("Failed to parse message from broker.");
  }
}

function waitForNextMessage(
  channel: Channel,
  queueName: string,
): Promise<Message | null> {
  const consumerTag = "foo";

  return new Promise((resolve) =>
    channel.consume(
      queueName,
      (message) => {
        channel.cancel(consumerTag);
        resolve(message);
      },
      { consumerTag },
    ),
  );
}
