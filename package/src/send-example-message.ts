import { mkdirSync, writeFileSync, type PathOrFileDescriptor } from "node:fs";
import path from "node:path";
import ky, { type KyInstance } from "ky";

export async function sendExampleMessage(
  receiver: SafeID,
  vibilia: VibiliaAdapter,
  xjustizNachricht: URL,
): Promise<MessageID> {
  const messageWorkingDirectoryId = globalThis.crypto.randomUUID();

  mkdirSync(messageWorkingDirectoryId, { recursive: true });

  const herkunftsnachweisXmlOutput = path.join(messageWorkingDirectoryId, `vhn.xml`);
  const herkunftsnachweisP7sOutput = path.join(messageWorkingDirectoryId, `vhn.p7s`);
  const xjustizNachrichtOutput = path.join(
    messageWorkingDirectoryId,
    `xjustiz_nachricht.xml`,
  );

  const xjustizNachrichtText = await ky.get(xjustizNachricht).text();
  writeFileSync(xjustizNachrichtOutput, xjustizNachrichtText);

  await createVertrauenswuerdigenHerkunftsnachweis(
    xjustizNachrichtOutput,
    vibilia,
    herkunftsnachweisXmlOutput,
    herkunftsnachweisP7sOutput,
  );

  const messageId = await initiateTransfer(
    receiver,
    xjustizNachrichtOutput,
    herkunftsnachweisXmlOutput,
    herkunftsnachweisP7sOutput,
    vibilia,
  );

  // wait for confirmation by intermediary
  // clean up mailbox

  return messageId;
}

async function createVertrauenswuerdigenHerkunftsnachweis(
  xjustizNachricht: XML,
  vibilia: VibiliaAdapter,
  herkunftsnachweisXmlOutput: PathOrFileDescriptor,
  herkunftsnachweisP7sOutput: PathOrFileDescriptor,
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
            attachment_filepaths: [],
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
    writeFileSync(herkunftsnachweisP7sOutput, rawHerkunftsnachweis.vhn_p7s);

    return undefined;
  }
}

async function initiateTransfer(
  receiver: SafeID,
  xjustizNachricht: PathOrFileDescriptor,
  herkunftsnachweisXml: PathOrFileDescriptor,
  herkunftsnachweisP7s: PathOrFileDescriptor,
  vibilia: VibiliaAdapter,
): Promise<string> {
  const response = await vibilia.api
    .post<SendMessageApiResponse>(vibilia.sendMessagePath(receiver), {
      json: {
        vhn_xml_filepath: herkunftsnachweisXml,
        vhn_p7s_filepath: herkunftsnachweisP7s,
        xjustiz_xml_filepath: xjustizNachricht,
        attachment_filepaths: [],
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

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("Vibilia REST integration", async () => {
    it("should just work somehow", async () => {
      const vibilia = vibiliaAdapter(
        new URL("http://localhost:8080"),
        process.env["SENDER_SAFE_ID"]!,
        process.env["SENDER_MESSAGE_BOX_PASSWORD"]!,
      );

      await sendExampleMessage(
        process.env["RECEIVER_SAFE_ID"]!,
        vibilia,
        new URL(
          "https://drive.usercontent.google.com/download?id=1BI_iQp-AAVk7PECEGAFTC6FtUCGs01Vg&export=download&authuser=0&confirm=t&uuid=4cc50a53-3b74-4277-b487-5142d2ead333&at=AMrWOn0axqQarlzLUiJyHIxsfZ0m%3A1794230370010",
        ),
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
      const herkunftsnachweisP7sOutput = path.join(
        messageWorkingDirectoryId,
        "vhn.p7s",
      );

      await createVertrauenswuerdigenHerkunftsnachweis(
        xjustizNachricht,
        vibilia,
        herkunftsnachweisXmlOutput,
        herkunftsnachweisP7sOutput,
      );

      expect(readFileSync(herkunftsnachweisXmlOutput, "utf-8")).toBeTruthy();
      expect(readFileSync(herkunftsnachweisP7sOutput, "utf-8")).toBeTruthy();
    });
  });
}
