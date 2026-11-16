import amqp, { type Message, type Channel } from "amqplib";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  sendMessage,
  vibiliaAdapter,
  type MessageID,
  type SafeID,
  type VibiliaAdapter,
} from "./send-message.ts";

async function main() {
  await loadMountedSecrets();

  const connection = await amqp.connect(
    process.env["AMQP_URL"] ?? "amqp://localhost:5671",
  );
  const channel = await connection.createChannel();
  const requestsExchangeName = "requests";
  const requestsQueueName = "requests";
  const repliesExchangeName = "replies";

  await channel.assertExchange(requestsExchangeName, "direct");
  await channel.assertQueue(requestsQueueName);
  await channel.bindQueue(
    requestsQueueName,
    requestsExchangeName,
    requestsQueueName,
  );

  await channel.assertExchange(repliesExchangeName, "direct");

  const vibilia = vibiliaAdapter(
    new URL(process.env["VIBILIA_BASE_URL"]!),
    process.env["SENDER_SAFE_ID"]!,
    process.env["SENDER_MESSAGE_BOX_PASSWORD"]!,
  );

  await consumeMessages(vibilia, channel, {
    requestsExchange: requestsExchangeName,
    requestsQueue: requestsQueueName,
    repliesExchange: repliesExchangeName,
  });
}

if (import.meta.main) {
  main();
}

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
  channel: Channel,
  brokerTopology: {
    requestsExchange: string;
    requestsQueue: string;
    repliesExchange: string;
  },
  abortSignal?: AbortSignal,
) {
  await channel.assertExchange(brokerTopology.requestsExchange, "direct");
  await channel.assertQueue(brokerTopology.requestsQueue);
  await channel.bindQueue(
    brokerTopology.requestsQueue,
    brokerTopology.requestsExchange,
    brokerTopology.requestsQueue,
  );

  await channel.assertExchange(brokerTopology.repliesExchange, "direct");

  const context: MessageHandlerContext = {
    vibilia,
    channel,
    repliesExchange: brokerTopology.repliesExchange,
  };

  const consumer = await channel.consume(
    brokerTopology.requestsQueue,
    (message) => {
      switch (message?.properties.type) {
        case "send-example-egvp-message":
          handleSendExampleEgvpMessage(context, message);
          break;
        case "send-egvp-message":
          handleSendEgvpMessage(context, message);
          break;
        default:
          console.error("Unknown message type:", message?.properties.type);
          break;
      }
    },
  );

  abortSignal?.addEventListener(
    "abort",
    () => {
      channel.cancel(consumer.consumerTag).catch(() => {
        console.error("Failed to cancel consumer during abort.");
      });
    },
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

  const userId = requireReplyUserId(context.channel, message);
  if (userId === undefined) {
    return;
  }

  try {
    const request = parseSendExampleEgvpMessage(message);
    const messageId = await sendMessage(
      request.receiver,
      context.vibilia,
      "https://drive.usercontent.google.com/download?id=1BI_iQp-AAVk7PECEGAFTC6FtUCGs01Vg&export=download&authuser=0&confirm=t&uuid=4cc50a53-3b74-4277-b487-5142d2ead333&at=AMrWOn0axqQarlzLUiJyHIxsfZ0m%3A1794230370010",
    );

    const reply: ExampleEgvpMessageSent = { messageId };

    publishReply(context, userId, reply, {
      type: "example-egvp-message-sent",
      correlationId: message.properties.correlationId,
    });

    context.channel.ack(message);
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

  const userId = requireReplyUserId(context.channel, message);
  if (userId === undefined) {
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

    const reply: EgvpMessageSent = { messageId };

    publishReply(context, userId, reply, {
      type: "egvp-message-sent",
      correlationId: message.properties.correlationId,
    });

    context.channel.ack(message);
  } catch (error) {
    console.error("Failed to handle message:", error);
  }
}

function requireReplyUserId(
  channel: Channel,
  message: Message,
): string | undefined {
  const userId = message.properties.userId;
  if (userId === undefined || userId.length === 0) {
    console.error("Request message is missing the AMQP user-id property.");
    channel.reject(message, false);
    return undefined;
  }

  return userId;
}

function publishReply(
  context: MessageHandlerContext,
  userId: string,
  reply: ExampleEgvpMessageSent | EgvpMessageSent,
  options: {
    type: string;
    correlationId?: string;
  },
) {
  context.channel.publish(
    context.repliesExchange,
    userId,
    Buffer.from(JSON.stringify(reply)),
    {
      contentType: "application/json",
      type: options.type,
      correlationId: options.correlationId,
      headers: {
        userId,
      },
    },
  );
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
    typeof parsedContent.xjustizNachricht === "string" &&
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
  channel: Channel;
  repliesExchange: string;
};
