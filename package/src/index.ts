import amqp, { type Message, type Channel } from "amqplib";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  sendMessage,
  vibiliaAdapter,
  type MessageID,
  type SafeID,
  type VibiliaAdapter,
} from "./send-message.js";

async function main() {
  await loadMountedSecrets();

  const connection = await amqp.connect(
    process.env["AMQP_URL"] ?? "amqp://localhost:5671",
  );
  const channel = await connection.createChannel();
  const requestsQueueName = "requests";
  const responsesQueueName = "responses";
  channel.assertQueue(requestsQueueName);
  channel.assertQueue(responsesQueueName);

  const vibilia = vibiliaAdapter(
    new URL(process.env["VIBILIA_BASE_URL"]!),
    process.env["SENDER_SAFE_ID"]!,
    process.env["SENDER_MESSAGE_BOX_PASSWORD"]!,
  );

  consumeMessages(vibilia, channel, {
    requests: requestsQueueName,
    responses: responsesQueueName,
  });
}

main();

export async function loadMountedSecrets(secretsDir = "/etc/secrets") {
  for (const name of await readdir(secretsDir).catch(() => [])) {
    if (!name.startsWith(".")) {
      process.env[name] ??= (
        await readFile(join(secretsDir, name), "utf8")
      ).trim();
    }
  }
}

export async function consumeMessages(
  vibilia: VibiliaAdapter,
  messageBroker: Channel,
  queueNames: { requests: string; responses: string },
  abortSignal?: AbortSignal,
) {
  const context = {
    vibilia,
    messageBroker,
    responseQueueName: queueNames.responses,
  };

  const consumer = await messageBroker.consume(
    queueNames.requests,
    (message) => {
      switch (message?.properties.type) {
        case "send-example-egvp-message":
          handleSendExampleEgvpMessage(context, message);
          break;
        case "send-egvp-message":
          handleSendEgvpMessage(context, message);
          break;
      }
    },
  );

  abortSignal?.addEventListener(
    "abort",
    () => messageBroker.cancel(consumer.consumerTag),
    { once: true },
  );
}

async function handleSendExampleEgvpMessage(
  context: MessageHandlerContext,
  message: Message | null,
): Promise<void> {
  if (message === null) {
    console.error("Why was there a 'null' message?");
    return;
  }

  try {
    const request = parseSendExampleEgvpMessage(message);
    const messageId = await sendMessage(
      request.receiver,
      context.vibilia,
      new URL(
        "https://drive.usercontent.google.com/download?id=1BI_iQp-AAVk7PECEGAFTC6FtUCGs01Vg&export=download&authuser=0&confirm=t&uuid=4cc50a53-3b74-4277-b487-5142d2ead333&at=AMrWOn0axqQarlzLUiJyHIxsfZ0m%3A1794230370010",
      ),
    );

    const response: ExampleEgvpMessageSent = { messageId };

    context.messageBroker.sendToQueue(
      context.responseQueueName,
      Buffer.from(JSON.stringify(response)),
    );

    context.messageBroker.ack(message);
  } catch (error) {
    console.error("Failed to handle message:", error);
  }
}

async function handleSendEgvpMessage(
  context: MessageHandlerContext,
  message: Message | null,
): Promise<void> {
  if (message === null) {
    console.error("Why was there a 'null' message?");
    return;
  }

  try {
    const request = parseSendEgvpMessage(message);
    const messageId = await sendMessage(
      request.receiver,
      context.vibilia,
      request.xjustizNachricht,
      request.attachments,
    );

    const response: EgvpMessageSent = { messageId };

    context.messageBroker.sendToQueue(
      context.responseQueueName,
      Buffer.from(JSON.stringify(response)),
    );

    context.messageBroker.ack(message);
  } catch (error) {
    console.error("Failed to handle message:", error);
  }
}

function parseSendExampleEgvpMessage(message: Message): SendExampleEgvpMessage {
  const parsedContent = JSON.parse(message.content.toString());

  if (
    typeof parsedContent === "object" &&
    parsedContent !== null &&
    "receiver" in parsedContent &&
    typeof parsedContent.receiver === "string"
  ) {
    return { receiver: parsedContent.receiver };
  } else {
    console.error("broken message", message.content.toString());
    throw new Error("Failed to parse message from broker.");
  }
}

function parseSendEgvpMessage(message: Message): SendEgvpMessage {
  const parsedContent = JSON.parse(message.content.toString());

  if (
    typeof parsedContent === "object" &&
    parsedContent !== null &&
    "receiver" in parsedContent &&
    typeof parsedContent.receiver === "string" &&
    "xjustizNachricht" in parsedContent &&
    typeof parsedContent.xjustizNachrichtUrl === "string" &&
    (!("attachments" in parsedContent) ||
      (Array.isArray(parsedContent.attachments) &&
        parsedContent.attachments.every(
          (maybeAttachment: unknown) =>
            typeof maybeAttachment === "object" &&
            maybeAttachment != null &&
            "name" in maybeAttachment &&
            typeof maybeAttachment.name === "string" &&
            "source" in maybeAttachment &&
            typeof maybeAttachment.source === "string",
        )))
  ) {
    return {
      receiver: parsedContent.receiver,
      xjustizNachricht: parsedContent.xjustizNachricht,
      attachments: parsedContent.attachments,
    };
  } else {
    console.error("broken message", message.content.toString());
    throw new Error("Failed to parse message from broker.");
  }
}

export type SendExampleEgvpMessage = {
  receiver: SafeID;
};

export type ExampleEgvpMessageSent = {
  messageId: MessageID;
};

export type SendEgvpMessage = {
  receiver: SafeID;
  xjustizNachricht: string;
  attachments?: Attachment[];
};

export type Attachment = {
  name: string;
  source: string;
};

export type EgvpMessageSent = {
  messageId: MessageID;
};

type MessageHandlerContext = {
  vibilia: VibiliaAdapter;
  messageBroker: Channel;
  responseQueueName: string;
};
