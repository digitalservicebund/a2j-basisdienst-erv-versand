import { type Message, type Channel } from "amqplib";
import {
  sendExampleMessage,
  type MessageID,
  type SafeID,
  type VibiliaAdapter,
} from "~/send-example-message";

function index() {}
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
