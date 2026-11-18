import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, type PathOrFileDescriptor } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import ky, { type KyInstance } from "ky";
import type {
  Attachment,
  DataArtifact,
  EmbeddedData,
  ReferencedData,
  Sha256Digest,
} from "./index.ts";

export async function sendMessage(
  receiver: SafeID,
  vibilia: VibiliaAdapter,
  xjustizMessage: DataArtifact,
  attachments?: Attachment[],
): Promise<MessageID> {
  const messageWorkingDirectoryPath = path.join(
    "/work",
    globalThis.crypto.randomUUID(),
  );

  mkdirSync(messageWorkingDirectoryPath, { recursive: true });

  const herkunftsnachweisXmlFilePath = path.join(
    messageWorkingDirectoryPath,
    `vhn.xml`,
  );
  const herkunftsnachweisSignatureP7sFilePath = path.join(
    messageWorkingDirectoryPath,
    `vhn.xml.p7s`,
  );
  const xjustizMessageXmlFilePath = path.join(
    messageWorkingDirectoryPath,
    `xjustiz_nachricht.xml`,
  );

  await writeDataArtifactToWorkingDirectoryFile(
    xjustizMessage,
    xjustizMessageXmlFilePath,
  );

  const attachmentFilePaths = await writeAttachmentsToWorkingDirectory(
    attachments ?? [],
    messageWorkingDirectoryPath,
  );

  await createVertrauenswuerdigenHerkunftsnachweis(
    xjustizMessageXmlFilePath,
    attachmentFilePaths,
    vibilia,
    herkunftsnachweisXmlFilePath,
    herkunftsnachweisSignatureP7sFilePath,
  );

  const messageId = await initiateTransfer(
    receiver,
    herkunftsnachweisXmlFilePath,
    herkunftsnachweisSignatureP7sFilePath,
    xjustizMessageXmlFilePath,
    attachmentFilePaths,
    vibilia,
  );

  // wait for confirmation by intermediary
  // clean up mailbox

  return messageId;
}

export async function loadBytesFromDataArtifact(
  dataArtifact: DataArtifact,
  httpClient: DataArtifactHttpClient = ky,
): Promise<Buffer> {
  if (isEmbeddedData(dataArtifact)) {
    return decodeEmbeddedBase64Data(dataArtifact);
  }

  return downloadAndVerifyReferencedData(dataArtifact, httpClient);
}

function isEmbeddedData(
  dataArtifact: DataArtifact,
): dataArtifact is EmbeddedData {
  return "content" in dataArtifact;
}

function decodeEmbeddedBase64Data(embeddedData: EmbeddedData): Buffer {
  return Buffer.from(embeddedData.content, "base64");
}

async function downloadAndVerifyReferencedData(
  referencedData: ReferencedData,
  httpClient: DataArtifactHttpClient,
): Promise<Buffer> {
  const parsedReferenceUri = new URL(referencedData.uri);
  if (parsedReferenceUri.protocol !== "https:") {
    throw new Error(`Unsupported URI protocol: ${parsedReferenceUri.protocol}`);
  }

  const downloadedBytes = Buffer.from(
    await httpClient.get(referencedData.uri).arrayBuffer(),
  );

  if (downloadedBytes.byteLength !== referencedData.size) {
    throw new Error(
      `Referenced data size mismatch: expected ${referencedData.size} bytes, got ${downloadedBytes.byteLength} bytes.`,
    );
  }

  const computedSha256Digest: Sha256Digest = `sha256:${createHash("sha256").update(downloadedBytes).digest("hex")}`;
  if (computedSha256Digest !== referencedData.digest) {
    throw new Error(
      `Referenced data digest mismatch: expected ${referencedData.digest}, got ${computedSha256Digest}.`,
    );
  }

  return downloadedBytes;
}

async function writeDataArtifactToWorkingDirectoryFile(
  dataArtifact: DataArtifact,
  targetFilePath: string,
): Promise<void> {
  const artifactBytes = await loadBytesFromDataArtifact(dataArtifact);
  await writeFile(targetFilePath, artifactBytes);
}

async function writeAttachmentsToWorkingDirectory(
  attachments: Attachment[],
  messageWorkingDirectoryPath: string,
): Promise<string[]> {
  return Promise.all(
    attachments.map(async (attachment): Promise<string> => {
      const attachmentFilePath = path.resolve(
        messageWorkingDirectoryPath,
        attachment.name,
      );
      if (
        path.dirname(attachmentFilePath) !==
        path.resolve(messageWorkingDirectoryPath)
      ) {
        throw new Error(`Invalid attachment file name: ${attachment.name}`);
      }
      await writeDataArtifactToWorkingDirectoryFile(
        attachment,
        attachmentFilePath,
      );
      return attachmentFilePath;
    }),
  );
}

async function createVertrauenswuerdigenHerkunftsnachweis(
  xjustizMessageXmlFilePath: string,
  attachmentFilePaths: string[],
  vibilia: VibiliaAdapter,
  herkunftsnachweisXmlOutput: PathOrFileDescriptor,
  herkunftsnachweisXmlP7sOutput: PathOrFileDescriptor,
): Promise<void> {
  const correlationId = globalThis.crypto.randomUUID();

  const response = await vibilia.api
    .post<CreateVhnApiResponse>(vibilia.createVhnPath, {
      json: {
        vhnPassword: process.env["SENDER_VHN_PASSWORD"],
        messages: [
          {
            vhn_id: correlationId,
            xjustiz_xml_or_filepath: xjustizMessageXmlFilePath,
            attachment_filepaths: attachmentFilePaths,
          },
        ],
      },
    })
    .json();

  if ("error_message" in response) {
    throw new Error(response.error_message);
  }

  const rawHerkunftsnachweis = response.vhns.find(
    ({ vhn_id }) => vhn_id === correlationId,
  );
  if (rawHerkunftsnachweis === undefined) {
    throw new Error(
      `Vibilia did not return a VHN for correlation ID ${correlationId}.`,
    );
  }

  writeFileSync(herkunftsnachweisXmlOutput, rawHerkunftsnachweis.vhn_xml);
  writeFileSync(
    herkunftsnachweisXmlP7sOutput,
    Buffer.from(rawHerkunftsnachweis.vhn_p7s, "base64"),
  );
}

async function initiateTransfer(
  receiver: SafeID,
  herkunftsnachweisXmlFilePath: string,
  herkunftsnachweisSignatureP7sFilePath: string,
  xjustizMessageXmlFilePath: string,
  attachmentFilePaths: string[],
  vibilia: VibiliaAdapter,
): Promise<string> {
  const response = await vibilia.api
    .post<SendMessageApiResponse>(vibilia.sendMessagePath(receiver), {
      json: {
        vhn_xml_filepath: herkunftsnachweisXmlFilePath,
        vhn_p7s_filepath: herkunftsnachweisSignatureP7sFilePath,
        xjustiz_xml_filepath: xjustizMessageXmlFilePath,
        attachment_filepaths: attachmentFilePaths,
      },
    })
    .json();

  if ("error_message" in response) {
    throw new Error(response.error_message);
  }

  return response.message_id;
}

export function vibiliaAdapter(
  baseUrl: URL,
  sender: SafeID,
  password: string,
): VibiliaAdapter {
  return {
    api: ky.create({
      baseUrl: baseUrl,
      headers: { password, Accept: "application/json" },
      retry: 0,
    }),
    createVhnPath: `/vhn/${encodeURIComponent(sender)}`,
    sendMessagePath(receiver) {
      return `/msgboxes/${encodeURIComponent(sender)}/${encodeURIComponent(receiver)}/messages`;
    },
  };
}

export type VibiliaAdapter = {
  api: KyInstance;
  createVhnPath: string;
  sendMessagePath(receiver: SafeID): string;
};

export type SafeID = string;
export type MessageID = string;

type CreateVhnApiResponse =
  | {
      vhns: { vhn_id: string; vhn_xml: string; vhn_p7s: string }[];
    }
  | { error_message: string };

type SendMessageApiResponse =
  | { message_id: MessageID }
  | { error_message: string };

type DataArtifactHttpClient = {
  get(uri: string): {
    arrayBuffer(): Promise<ArrayBuffer>;
  };
};

if (import.meta.vitest) {
  const { describe, it, expect, vi } = import.meta.vitest;

  function embeddedDataFromBytes(bytes: Buffer): EmbeddedData {
    return { content: bytes.toString("base64") };
  }

  describe("Data Artifact loading", () => {
    it("decodes EmbeddedData from Base64 content", async () => {
      const rawXmlBytes = Buffer.from("<xjustiz>embedded</xjustiz>", "utf-8");
      const loadedBytes = await loadBytesFromDataArtifact(
        embeddedDataFromBytes(rawXmlBytes),
      );

      expect(loadedBytes).toEqual(rawXmlBytes);
    });

    it("downloads ReferencedData over HTTPS and verifies byte size and SHA-256 digest", async () => {
      const rawAttachmentBytes = Buffer.from(
        "referenced-attachment-bytes",
        "utf-8",
      );
      const expectedDigest: Sha256Digest = `sha256:${createHash("sha256").update(rawAttachmentBytes).digest("hex")}`;
      const get = vi.fn().mockReturnValue({
        arrayBuffer: async () =>
          rawAttachmentBytes.buffer.slice(
            rawAttachmentBytes.byteOffset,
            rawAttachmentBytes.byteOffset + rawAttachmentBytes.byteLength,
          ),
      });

      const loadedBytes = await loadBytesFromDataArtifact(
        {
          uri: "https://some.upstream.context/some/resource",
          size: rawAttachmentBytes.byteLength,
          digest: expectedDigest,
        },
        { get },
      );

      expect(get).toHaveBeenCalledWith(
        "https://some.upstream.context/some/resource",
      );
      expect(loadedBytes).toEqual(rawAttachmentBytes);
    });

    it("rejects ReferencedData when byte size or SHA-256 digest does not match", async () => {
      const actualBytes = Buffer.from("actual-bytes", "utf-8");
      const validDigest: Sha256Digest = `sha256:${createHash("sha256").update(actualBytes).digest("hex")}`;
      const httpClient = {
        get: () => ({
          arrayBuffer: async () =>
            actualBytes.buffer.slice(
              actualBytes.byteOffset,
              actualBytes.byteOffset + actualBytes.byteLength,
            ),
        }),
      };

      await expect(
        loadBytesFromDataArtifact(
          {
            uri: "https://some.upstream.context/some/resource",
            size: actualBytes.byteLength + 1,
            digest: validDigest,
          },
          httpClient,
        ),
      ).rejects.toThrow("Referenced data size mismatch");

      await expect(
        loadBytesFromDataArtifact(
          {
            uri: "https://some.upstream.context/some/resource",
            size: actualBytes.byteLength,
            digest: `sha256:${"0".repeat(64)}`,
          },
          httpClient,
        ),
      ).rejects.toThrow("Referenced data digest mismatch");
    });
  });

  describe("Vibilia REST integration", async () => {
    it.skip("should just work somehow", async () => {
      const { readFileSync } = await import("node:fs");
      const vibilia = vibiliaAdapter(
        new URL("http://localhost:8080"),
        process.env["SENDER_SAFE_ID"]!,
        process.env["SENDER_MESSAGE_BOX_PASSWORD"]!,
      );
      const xjustizMessage = readFileSync(
        new URL("./xjustiz_nachricht.xml", import.meta.url),
      );

      await sendMessage(
        process.env["RECEIVER_SAFE_ID"]!,
        vibilia,
        embeddedDataFromBytes(xjustizMessage),
      );
    });

    it("creates a VertrauenswuerdigenHerkunftsnachweis through Vibilia", async () => {
      const { readFileSync } = await import("node:fs");

      const xjustizMessage = readFileSync(
        new URL("./xjustiz_nachricht.xml", import.meta.url),
        "utf-8",
      );
      const vibilia = vibiliaAdapter(
        new URL("http://localhost:8080"),
        process.env["SENDER_SAFE_ID"]!,
        process.env["SENDER_MESSAGE_BOX_PASSWORD"]!,
      );
      const messageWorkingDirectoryId = globalThis.crypto.randomUUID();

      mkdirSync(messageWorkingDirectoryId, { recursive: true });
      const herkunftsnachweisXmlOutput = path.join(
        messageWorkingDirectoryId,
        "vhn.xml",
      );
      const herkunftsnachweisXmlP7sOutput = path.join(
        messageWorkingDirectoryId,
        "vhn.xml.p7s",
      );

      await createVertrauenswuerdigenHerkunftsnachweis(
        xjustizMessage,
        [],
        vibilia,
        herkunftsnachweisXmlOutput,
        herkunftsnachweisXmlP7sOutput,
      );

      expect(readFileSync(herkunftsnachweisXmlOutput, "utf-8")).toBeTruthy();
      expect(readFileSync(herkunftsnachweisXmlP7sOutput, "utf-8")).toBeTruthy();
    });
  });
}
