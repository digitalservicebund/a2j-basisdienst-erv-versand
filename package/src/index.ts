import amqp, { type Message, type Channel } from "amqplib";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  sendExampleMessage,
  vibiliaAdapter,
  type MessageID,
  type SafeID,
  type VibiliaAdapter,
} from "./send-example-message.ts";

async function main() {
    await loadMountedSecrets();

    const connection = await amqp.connect(process.env["AMQP_URL"] ?? "amqp://localhost:5671");
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

    consumeMessages(
      vibilia,
      channel,
      {
        requests: requestsQueueName,
        responses: responsesQueueName,
      },
    );
}

main();

export async function loadMountedSecrets(secretsDir = "/etc/secrets") {
  for (const name of await readdir(secretsDir).catch(() => [])) {
    if (!name.startsWith(".")) {
      process.env[name] ??= (await readFile(join(secretsDir, name), "utf8")).trim();
    }
  }
}

export async function consumeMessages(
  vibilia: VibiliaAdapter,
  messageBroker: Channel,
  queueNames: { requests: string; responses: string },
  abortSignal?: AbortSignal,
) {
  const consumer = await messageBroker.consume(
    queueNames.requests,
    handleInitiateTransferMessage.bind({
      vibilia,
      messageBroker,
      responseQueueName: queueNames.responses,
    }),
  );

  abortSignal?.addEventListener(
    "abort",
    () => messageBroker.cancel(consumer.consumerTag),
    { once: true },
  );
}

async function handleInitiateTransferMessage(
  this: {
    vibilia: VibiliaAdapter;
    messageBroker: Channel;
    responseQueueName: string;
  },
  message: Message | null,
): Promise<void> {
  if (message === null) {
    console.error("Why was there a 'null' message?");
    return;
  }

  try {
    const request = parseMessage(message);
    const messageId = await sendExampleMessage(request.receiver, this.vibilia);

    const response: TransferSuccessfulMessage = { messageId };

    this.messageBroker.sendToQueue(
      this.responseQueueName,
      Buffer.from(JSON.stringify(response)),
    );

    this.messageBroker.ack(message);
  } catch (error) {
    console.error("Failed to handle message:", error);
  }
}

function parseMessage(message: Message): InitiateTransferMessage {
  const parsedContent = JSON.parse(message.content.toString());

  if (
    typeof parsedContent === "object" &&
    "receiver" in parsedContent &&
    typeof parsedContent.receiver === "string"
  ) {
    return { receiver: parsedContent.receiver };
  } else {
    console.error("broken message", message.content.toString());
    throw new Error("Failed to parse message from broker.");
  }
}

export type InitiateTransferMessage = {
  receiver: SafeID;
};

export type TransferSuccessfulMessage = {
  messageId: MessageID;
};
