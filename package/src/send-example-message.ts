import { readFileSync } from 'node:fs'
import ky, { type KyInstance } from "ky";

const xjustizNachricht = readFileSync(
  new URL('./xjustiz_nachricht.xml', import.meta.url),
  'utf-8'
)

export async function sendExampleMessage(
  receiver: SafeID,
  vibilia: VibiliaAdapter,
): Promise<MessageID> {
  const herkunftsnachweis = await createVertrauenswuerdigenHerkunftsnachweis(
    xjustizNachricht,
    vibilia,
  );

  const messageId = await initiateTransfer(
    receiver,
    xjustizNachricht,
    herkunftsnachweis,
    vibilia,
  );

  // wait for confirmation by intermediary
  // clean up mailbox

  return messageId;
}

async function createVertrauenswuerdigenHerkunftsnachweis(
  xjustizNachricht: XML,
  vibilia: VibiliaAdapter,
): Promise<VertrauenswuerdigerHerkunftsnachweis> {
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

    return {
      sessionContainer: rawHerkunftsnachweis.vhn_xml,
      signature: rawHerkunftsnachweis.vhn_p7s,
    };
  }
}

async function initiateTransfer(
  receiver: SafeID,
  xjustizNachricht: XML,
  herkunftsnachweis: VertrauenswuerdigerHerkunftsnachweis,
  vibilia: VibiliaAdapter,
): Promise<string> {
  const response = await vibilia.api
    .post<SendMessageApiResponse>(vibilia.sendMessagePath(receiver), {
      json: {
        vhn_xml: herkunftsnachweis.sessionContainer,
        vhn_p7s: herkunftsnachweis.signature,
        xjustiz_xml: xjustizNachricht,
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

type VertrauenswuerdigerHerkunftsnachweis = {
  sessionContainer: XML;
  signature: Base64Data;
};

type XML = string;
type Base64Data = string;

type CreateVhnApiResponse =
  | {
      vhns: { vhn_id: string; vhn_xml: string; vhn_p7s: string }[];
    }
  | { error_message: string };

type SendMessageApiResponse =
  | { message_id: MessageID }
  | { error_message: string };

if (import.meta.vitest) {
  const { describe, it, expect, inject } = import.meta.vitest;

  describe("Vibilia REST integration", async () => {
    it("should just work somehow", async () => {
      const vibilia = vibiliaAdapter(
        new URL("http://localhost:8080"),
        process.env["SENDER_SAFE_ID"]!,
        process.env["SENDER_MESSAGE_BOX_PASSWORD"]!,
      );

      await sendExampleMessage(process.env["RECEIVER_SAFE_ID"]!, vibilia);
    });

    it("creates a VertrauenswuerdigenHerkunftsnachweis through Vibilia", async () => {
      const vibilia = vibiliaAdapter(
        new URL("http://localhost:8080"),
        process.env["SENDER_SAFE_ID"]!,
        process.env["SENDER_MESSAGE_BOX_PASSWORD"]!,
      );

      const herkunftsnachweis =
        await createVertrauenswuerdigenHerkunftsnachweis(
          xjustizNachricht,
          vibilia,
        );

      expect(herkunftsnachweis).toBeDefined();
    });
  });
}
