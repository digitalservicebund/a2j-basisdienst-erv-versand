import { mkdirSync, writeFileSync, type PathOrFileDescriptor } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import ky, { type KyInstance } from "ky";

export async function sendMessage(
  receiver: SafeID,
  vibilia: VibiliaAdapter,
  xjustizNachricht: string,
  attachments?: Attachment[],
): Promise<MessageID> {
  const messageWorkingDirectory = path.join(
    "/work",
    globalThis.crypto.randomUUID(),
  );

  mkdirSync(messageWorkingDirectory, { recursive: true });

  const herkunftsnachweisXmlOutput = path.join(
    messageWorkingDirectory,
    `vhn.xml`,
  );
  const herkunftsnachweisXmlP7sOutput = path.join(
    messageWorkingDirectory,
    `vhn.xml.p7s`,
  );
  const xjustizNachrichtOutput = path.join(
    messageWorkingDirectory,
    `xjustiz_nachricht.xml`,
  );

  const xjustizNachrichtText = await ky.get(xjustizNachricht).text();
  writeFileSync(xjustizNachrichtOutput, xjustizNachrichtText);

  await downloadAttachments(attachments ?? [], messageWorkingDirectory);

  const attachmentFilePaths =
    attachments?.map(({ name }) => path.join(messageWorkingDirectory, name)) ??
    [];

  await createVertrauenswuerdigenHerkunftsnachweis(
    xjustizNachrichtOutput,
    attachmentFilePaths,
    vibilia,
    herkunftsnachweisXmlOutput,
    herkunftsnachweisXmlP7sOutput,
  );

  const messageId = await initiateTransfer(
    receiver,
    herkunftsnachweisXmlOutput,
    herkunftsnachweisXmlP7sOutput,
    xjustizNachrichtOutput,
    attachmentFilePaths,
    vibilia,
  );

  // wait for confirmation by intermediary
  // clean up mailbox

  return messageId;
}

async function downloadAttachments(
  attachments: Attachment[],
  messageWorkingDirectory: string,
): Promise<void> {
  await Promise.all(
    attachments.map(async (attachment): Promise<void> => {
      const output = path.join(messageWorkingDirectory, attachment.name);
      const content = Buffer.from(
        await ky.get(attachment.source).arrayBuffer(),
      );
      await writeFile(output, content);
    }),
  );
}

async function createVertrauenswuerdigenHerkunftsnachweis(
  xjustizNachricht: XML,
  attachmentFilePaths: string[],
  vibilia: VibiliaAdapter,
  herkunftsnachweisXmlOutput: PathOrFileDescriptor,
  herkunftsnachweisXmlP7sOutput: PathOrFileDescriptor,
): Promise<void> {
  const correlationID = globalThis.crypto.randomUUID();

  const response = await vibilia.api
    .post<CreateVhnApiResponse>(vibilia.createVhnPath, {
      json: {
        vhnPassword: process.env["SENDER_VHN_PASSWORD"],
        messages: [
          {
            vhn_id: correlationID,
            xjustiz_xml_or_filepath: xjustizNachricht,
            attachment_filepaths: attachmentFilePaths,
          },
        ],
      },
    })
    .json();

  if ("error_message" in response) {
    throw new Error(response.error_message);
  } else {
    const rawHerkunftsnachweis = response.vhns.find(
      ({ vhn_id }) => vhn_id === correlationID,
    );
    if (rawHerkunftsnachweis === undefined) {
      throw new Error(
        `Vibilia did not return a VHN for correlation ID ${correlationID}.`,
      );
    }

    writeFileSync(herkunftsnachweisXmlOutput, rawHerkunftsnachweis.vhn_xml);
    writeFileSync(herkunftsnachweisXmlP7sOutput, rawHerkunftsnachweis.vhn_p7s);

    return undefined;
  }
}

async function initiateTransfer(
  receiver: SafeID,
  herkunftsnachweisXmlFilePath: string,
  herkunftsnachweisP7sFilePath: string,
  xjustizNachricht: string,
  attachmentFilePaths: string[],
  vibilia: VibiliaAdapter,
): Promise<string> {
  const response = await vibilia.api
    .post<SendMessageApiResponse>(vibilia.sendMessagePath(receiver), {
      json: {
        vhn_xml_filepath: herkunftsnachweisXmlFilePath,
        vhn_p7s_filepath: herkunftsnachweisP7sFilePath,
        xjustiz_xml_filepath: xjustizNachricht,
        attachment_filepaths: attachmentFilePaths,
      },
    })
    .json();

  if ("error_message" in response) {
    throw new Error(response.error_message);
  } else {
    return response.message_id;
  }
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

type XML = string;

type CreateVhnApiResponse =
  | {
      vhns: { vhn_id: string; vhn_xml: string; vhn_p7s: string }[];
    }
  | { error_message: string };

type SendMessageApiResponse =
  | { message_id: MessageID }
  | { error_message: string };

type Attachment = {
  name: string;
  source: string;
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("Vibilia REST integration", async () => {
    it("should just work somehow", async () => {
      const vibilia = vibiliaAdapter(
        new URL("http://localhost:8080"),
        process.env["SENDER_SAFE_ID"]!,
        process.env["SENDER_MESSAGE_BOX_PASSWORD"]!,
      );

      await sendMessage(
        process.env["RECEIVER_SAFE_ID"]!,
        vibilia,
        "https://drive.usercontent.google.com/download?id=1BI_iQp-AAVk7PECEGAFTC6FtUCGs01Vg&export=download&authuser=0&confirm=t&uuid=4cc50a53-3b74-4277-b487-5142d2ead333&at=AMrWOn0axqQarlzLUiJyHIxsfZ0m%3A1794230370010",
      );
    });

    it("creates a VertrauenswuerdigenHerkunftsnachweis through Vibilia", async () => {
      const { readFileSync } = await import("node:fs");

      const xjustizNachricht = readFileSync(
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
        xjustizNachricht,
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
