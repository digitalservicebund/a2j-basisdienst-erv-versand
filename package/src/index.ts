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
      exampleXjustizMessage,
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
      request.xjustizMessage,
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
    `replies.${userId}`,
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
  }

  console.error("broken message", message.content.toString());
  throw new Error("Failed to parse message from broker.");
}

export function parseSendEgvpMessage(message: Message): SendEgvpMessage {
  const parsedMessagePayload = JSON.parse(message.content.toString());

  if (
    isJsonObject(parsedMessagePayload) &&
    typeof parsedMessagePayload["receiver"] === "string" &&
    isDataArtifact(parsedMessagePayload["xjustizMessage"]) &&
    (parsedMessagePayload["attachments"] === undefined ||
      (Array.isArray(parsedMessagePayload["attachments"]) &&
        parsedMessagePayload["attachments"].every(isAttachment)))
  ) {
    return {
      receiver: parsedMessagePayload["receiver"],
      xjustizMessage: parsedMessagePayload["xjustizMessage"],
      attachments: parsedMessagePayload["attachments"],
    };
  }

  console.error("broken message", message.content.toString());
  throw new Error("Failed to parse message from broker.");
}

function isJsonObject(
  candidate: unknown,
): candidate is Record<string, unknown> {
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    !Array.isArray(candidate)
  );
}

function isDataArtifact(candidate: unknown): candidate is DataArtifact {
  return isEmbeddedData(candidate) || isReferencedData(candidate);
}

function isEmbeddedData(candidate: unknown): candidate is EmbeddedData {
  return (
    isJsonObject(candidate) &&
    isValidBase64String(candidate["content"]) &&
    candidate["uri"] === undefined &&
    candidate["size"] === undefined &&
    candidate["digest"] === undefined
  );
}

function isReferencedData(candidate: unknown): candidate is ReferencedData {
  return (
    isJsonObject(candidate) &&
    candidate["content"] === undefined &&
    isHttpsUriString(candidate["uri"]) &&
    typeof candidate["size"] === "number" &&
    Number.isInteger(candidate["size"]) &&
    candidate["size"] >= 1 &&
    isSha256Digest(candidate["digest"])
  );
}

function isAttachment(candidate: unknown): candidate is Attachment {
  return (
    isJsonObject(candidate) &&
    typeof candidate["name"] === "string" &&
    candidate["name"].length > 0 &&
    candidate["name"].length <= 90 &&
    isDataArtifact(candidate)
  );
}

function isValidBase64String(candidate: unknown): candidate is string {
  if (
    typeof candidate !== "string" ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      candidate,
    )
  ) {
    return false;
  }

  return Buffer.from(candidate, "base64").toString("base64") === candidate;
}

function isHttpsUriString(candidate: unknown): candidate is HttpsUriString {
  if (typeof candidate !== "string" || !candidate.startsWith("https://")) {
    return false;
  }

  try {
    return new URL(candidate).protocol === "https:";
  } catch (error) {
    if (error instanceof TypeError) {
      return false;
    }
    throw error;
  }
}

function isSha256Digest(candidate: unknown): candidate is Sha256Digest {
  return (
    typeof candidate === "string" && /^sha256:[a-f0-9]{64}$/.test(candidate)
  );
}

const exampleXjustizMessage: ReferencedData = {
  uri: "https://drive.usercontent.google.com/download?id=1BI_iQp-AAVk7PECEGAFTC6FtUCGs01Vg&export=download&confirm=t",
  size: 2528,
  digest:
    "sha256:33d2dd130ce82aa84783e0396633566f4377077ad4648f879d76a4f36761d953",
};

export type SendExampleEgvpMessage = {
  receiver: SafeID;
};

export type ExampleEgvpMessageSent = {
  messageId: MessageID;
};

export type SendEgvpMessage = {
  receiver: SafeID;
  xjustizMessage: DataArtifact;
  attachments?: Attachment[];
};

export type HttpsUriString = `https://${string}`;
export type Sha256Digest = `sha256:${string}`;

export type EmbeddedData = {
  content: string;
  uri?: never;
  size?: never;
  digest?: never;
};

export type ReferencedData = {
  content?: never;
  uri: HttpsUriString;
  size: number;
  digest: Sha256Digest;
};

export type DataArtifact = EmbeddedData | ReferencedData;

export type Attachment = DataArtifact & {
  name: string;
};

export type EgvpMessageSent = {
  messageId: MessageID;
};

type MessageHandlerContext = {
  vibilia: VibiliaAdapter;
  channel: Channel;
  repliesExchange: string;
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  function toAmqpMessage(payload: unknown): Message {
    return {
      content: Buffer.from(JSON.stringify(payload)),
      fields: {} as Message["fields"],
      properties: {} as Message["properties"],
    };
  }

  describe("parseSendEgvpMessage", () => {
    it("parses embedded xjustizMessage and embedded/referenced attachments", () => {
      const payload = {
        receiver: "DE.Justiz.71051095-c471-46e3-1760-56d2229c3bb2.a740",
        xjustizMessage: {
          content: Buffer.from("<xjustiz/>").toString("base64"),
        },
        attachments: [
          {
            name: "embedded.pdf",
            content: Buffer.from("pdf-bytes").toString("base64"),
          },
          {
            name: "referenced.pdf",
            uri: "https://example.com/referenced.pdf",
            size: 12,
            digest:
              "sha256:cd42c22de35760ebeec2757f4a2909203d90f5c6ebb398c7491698ecc7a65d92",
          },
        ],
      };

      expect(parseSendEgvpMessage(toAmqpMessage(payload))).toEqual(payload);
    });

    it("rejects artifacts mixing embedded and referenced fields or non-HTTPS URIs", () => {
      expect(() =>
        parseSendEgvpMessage(
          toAmqpMessage({
            receiver: "DE.Justiz.71051095-c471-46e3-1760-56d2229c3bb2.a740",
            xjustizMessage: {
              content: "abc=",
              uri: "https://example.com/file.xml",
              size: 4,
              digest:
                "sha256:cd42c22de35760ebeec2757f4a2909203d90f5c6ebb398c7491698ecc7a65d92",
            },
          }),
        ),
      ).toThrow("Failed to parse message from broker.");

      expect(() =>
        parseSendEgvpMessage(
          toAmqpMessage({
            receiver: "DE.Justiz.71051095-c471-46e3-1760-56d2229c3bb2.a740",
            xjustizMessage: {
              uri: "http://example.com/file.xml",
              size: 4,
              digest:
                "sha256:cd42c22de35760ebeec2757f4a2909203d90f5c6ebb398c7491698ecc7a65d92",
            },
          }),
        ),
      ).toThrow("Failed to parse message from broker.");

      expect(() =>
        parseSendEgvpMessage(
          toAmqpMessage({
            receiver: "DE.Justiz.71051095-c471-46e3-1760-56d2229c3bb2.a740",
            xjustizMessage: {
              uri: "https:example.com/file.xml",
              size: 4,
              digest:
                "sha256:cd42c22de35760ebeec2757f4a2909203d90f5c6ebb398c7491698ecc7a65d92",
            },
          }),
        ),
      ).toThrow("Failed to parse message from broker.");
    });

    it("rejects malformed Base64 and malformed HTTPS references", () => {
      expect(() =>
        parseSendEgvpMessage(
          toAmqpMessage({
            receiver: "DE.Justiz.71051095-c471-46e3-1760-56d2229c3bb2.a740",
            xjustizMessage: {
              content: "not base64!!!",
            },
          }),
        ),
      ).toThrow("Failed to parse message from broker.");

      expect(() =>
        parseSendEgvpMessage(
          toAmqpMessage({
            receiver: "DE.Justiz.71051095-c471-46e3-1760-56d2229c3bb2.a740",
            xjustizMessage: {
              uri: "https://",
              size: 4,
              digest:
                "sha256:cd42c22de35760ebeec2757f4a2909203d90f5c6ebb398c7491698ecc7a65d92",
            },
          }),
        ),
      ).toThrow("Failed to parse message from broker.");
    });
  });
}
