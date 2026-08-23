const {
  getAdapter,
  listProviders,
  assertAdapter,
} = require("../../../utils/knowledgeSources");
const { createImapAdapter } = require("../../../utils/knowledgeSources/adapters/imap");
const {
  createGmailMailAdapter,
  gmailApiClient,
} = require("../../../utils/knowledgeSources/adapters/gmail-mail");
const {
  createOutlookMailAdapter,
} = require("../../../utils/knowledgeSources/adapters/outlook-mail");
const { ImapSession } = require("../../../utils/knowledgeSources/imapClient");
const {
  isSkippedMailbox,
  mailDownloadPayload,
  DELTA_CAP,
} = require("../../../utils/knowledgeSources/mail");

const TWO_MESSAGES = [
  {
    id: "11",
    uid: "11",
    from: "alice@example.com",
    to: "team@example.com",
    subject: "Q1 handbook",
    date: "2024-01-01T10:00:00.000Z",
    body: "Please read the attached handbook.",
  },
  {
    id: "12",
    uid: "12",
    from: "bob@example.com",
    to: "team@example.com",
    subject: "Refund policy",
    date: "2024-01-02T10:00:00.000Z",
    body: "Refunds are issued within 14 days.",
    attachments: ["policy.pdf"],
  },
];

describe("email inbox knowledge source adapters", () => {
  it("self-registers imap, gmail-mail, and outlook-mail", () => {
    for (const provider of ["imap", "gmail-mail", "outlook-mail"]) {
      const adapter = getAdapter(provider);
      expect(adapter).not.toBeNull();
      expect(() => assertAdapter(adapter)).not.toThrow();
      expect(listProviders()).toContain(provider);
    }
  });

  it("IMAP mock lists two messages, downloads markdown, and advances UID cursor", async () => {
    const adapter = createImapAdapter({
      config: { host: "imap.example.com", user: "me", password: "secret" },
      listMessages: async (_config, { cursor }) => ({
        items: TWO_MESSAGES,
        cursor: JSON.stringify({ INBOX: "12" }),
        requestedCursor: cursor,
      }),
    });

    const listed = await adapter.list({ cursor: "10" });
    expect(listed.items).toHaveLength(2);
    expect(listed.items[0].subject).toBe("Q1 handbook");
    expect(listed.cursor).toBe(JSON.stringify({ INBOX: "12" }));

    const downloaded = await adapter.download(listed.items[0]);
    expect(downloaded.from).toBe("alice@example.com");
    expect(downloaded.to).toBe("team@example.com");
    expect(downloaded.subject).toBe("Q1 handbook");
    expect(downloaded.date).toBe("2024-01-01T10:00:00.000Z");
    expect(downloaded.body).toContain("handbook");
    expect(downloaded.markdown).toContain("From: alice@example.com");
    expect(downloaded.mime).toBe("text/markdown");

    const withAttachment = await adapter.download(listed.items[1]);
    expect(withAttachment.markdown).toContain("Attachments skipped: policy.pdf");

    const delta = await adapter.delta("10");
    expect(delta.items).toHaveLength(2);
    expect(adapter.toChunkSource(listed.items[0])).toBe("imap://11");
    expect(adapter.watchHint()).toEqual({
      poll: true,
      staleAfterMs: 60 * 60 * 1000,
    });
  });

  it("Gmail mock lists two messages and uses historyId as cursor", async () => {
    const adapter = createGmailMailAdapter({
      client: {
        async list({ limit }) {
          expect(limit).toBe(DELTA_CAP);
          return {
            items: TWO_MESSAGES.map((m) => ({ ...m, id: `gm-${m.id}` })),
            cursor: "history-99",
          };
        },
        async get(item) {
          return TWO_MESSAGES.find((m) => `gm-${m.id}` === item.id) || item;
        },
      },
    });

    const listed = await adapter.list();
    expect(listed.items).toHaveLength(2);
    expect(listed.cursor).toBe("history-99");

    const downloaded = await adapter.download(listed.items[0]);
    expect(downloaded.from).toBe("alice@example.com");
    expect(downloaded.subject).toBe("Q1 handbook");
    expect(downloaded.markdown).not.toContain("Refund");
    expect(downloaded.markdown).toContain("# Q1 handbook");
    expect(adapter.toChunkSource(listed.items[0])).toBe("gmail-mail://gm-11");

    const delta = await adapter.delta("history-1");
    expect(delta.items).toHaveLength(2);
    expect(delta.cursor).toBe("history-99");
  });

  it("Gmail REST history omits SPAM/TRASH instead of indexing stubs", async () => {
    const prevFetch = global.fetch;
    global.fetch = jest.fn(async (url) => {
      const u = String(url);
      const json = (data) => ({ ok: true, json: async () => data });
      if (u.includes("/history?")) {
        return json({
          historyId: "h2",
          history: [
            {
              messagesAdded: [
                { message: { id: "spam1" } },
                { message: { id: "ok1" } },
              ],
            },
          ],
        });
      }
      if (u.includes("/messages/spam1"))
        return json({ id: "spam1", labelIds: ["SPAM", "INBOX"] });
      if (u.includes("/messages/ok1") && u.includes("format=minimal"))
        return json({ id: "ok1", labelIds: ["INBOX"] });
      if (u.includes("/messages/ok1"))
        return json({
          id: "ok1",
          labelIds: ["INBOX"],
          payload: {
            mimeType: "text/plain",
            headers: [
              { name: "From", value: "a@b.c" },
              { name: "To", value: "c@d.e" },
              { name: "Subject", value: "Hello" },
              { name: "Date", value: "today" },
            ],
            body: { data: Buffer.from("hello").toString("base64url") },
          },
        });
      throw new Error(`unexpected ${u}`);
    });

    try {
      const api = gmailApiClient({ accessToken: "tok" });
      const listed = await api.list({ cursor: "h1", limit: 200 });
      expect(listed.items.map((item) => item.id)).toEqual(["ok1"]);
      expect(listed.cursor).toBe("h2");

      const adapter = createGmailMailAdapter({ client: api });
      await expect(adapter.download({ id: "spam1" })).rejects.toThrow(
        /spam, trash, or unavailable/
      );
      const downloaded = await adapter.download({ id: "ok1" });
      expect(downloaded.subject).toBe("Hello");
    } finally {
      global.fetch = prevFetch;
    }
  });

  it("Outlook mock lists two messages and stores a deltaLink cursor", async () => {
    const deltaLink =
      "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=abc";
    const adapter = createOutlookMailAdapter({
      client: {
        async request(url) {
          expect(String(url)).toContain("mailFolders/inbox/messages/delta");
          return {
            success: true,
            data: {
              value: TWO_MESSAGES.map((m) => ({
                id: m.id,
                subject: m.subject,
                from: { emailAddress: { address: m.from } },
                toRecipients: [
                  { emailAddress: { address: m.to } },
                ],
                receivedDateTime: m.date,
                body: { content: m.body, contentType: "text" },
                hasAttachments: !!m.attachments,
              })),
              "@odata.deltaLink": deltaLink,
            },
          };
        },
      },
    });

    const listed = await adapter.list();
    expect(listed.items).toHaveLength(2);
    expect(listed.cursor).toContain("deltatoken=abc");

    const downloaded = await adapter.download(listed.items[1]);
    expect(downloaded.from).toBe("bob@example.com");
    expect(downloaded.body).toContain("14 days");
    expect(adapter.toChunkSource(listed.items[1])).toBe("outlook-mail://12");
    expect(adapter.watchHint().staleAfterMs).toBe(3600000);
  });

  it("Outlook keeps unconsumed Graph page items in the cursor", async () => {
    const graphMessage = (id, subject) => ({
      id,
      subject,
      from: { emailAddress: { address: "a@b.c" } },
      toRecipients: [{ emailAddress: { address: "c@d.e" } }],
      receivedDateTime: "2024-01-01T00:00:00Z",
      body: { content: subject, contentType: "text" },
    });
    const inbox = Array.from({ length: 199 }, (_, i) =>
      graphMessage(`in-${i}`, `inbox ${i}`)
    );
    const sent = [
      graphMessage("s1", "sent 1"),
      graphMessage("s2", "sent 2"),
      graphMessage("s3", "sent 3"),
    ];
    const urls = [];
    const adapter = createOutlookMailAdapter({
      config: { includeSent: true },
      client: {
        async request(url) {
          const u = String(url);
          urls.push(u);
          if (u.includes("sentitems")) {
            if (u.includes("deltatoken=sent")) {
              return {
                success: true,
                data: { value: [], "@odata.deltaLink": u },
              };
            }
            return {
              success: true,
              data: {
                value: sent,
                "@odata.deltaLink":
                  "https://graph.microsoft.com/v1.0/me/mailFolders/sentitems/messages/delta?$deltatoken=sent",
              },
            };
          }
          if (u.includes("deltatoken=inbox")) {
            return {
              success: true,
              data: { value: [], "@odata.deltaLink": u },
            };
          }
          return {
            success: true,
            data: {
              value: inbox,
              "@odata.deltaLink":
                "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=inbox",
            },
          };
        },
      },
    });

    const first = await adapter.list({ config: { includeSent: true } });
    expect(first.items).toHaveLength(200);
    expect(first.items.some((item) => item.id === "s1")).toBe(true);
    expect(first.items.some((item) => item.id === "s2")).toBe(false);
    const sentCursor = JSON.parse(first.cursor).sentitems;
    expect(sentCursor.pending).toEqual(["s2", "s3"]);
    expect(urls.some((u) => u.includes("sentitems") && u.includes("$top=1"))).toBe(
      true
    );

    const second = await adapter.list({
      cursor: first.cursor,
      config: { includeSent: true },
    });
    expect(second.items.map((item) => item.id)).toEqual(
      expect.arrayContaining(["s2", "s3"])
    );
  });

  it("refuses IMAP LOGIN without TLS", async () => {
    const session = new ImapSession({
      host: "imap.example.com",
      user: "me",
      password: "secret",
      tls: false,
    });
    await expect(session.connect()).rejects.toThrow(/plaintext/);
  });

  it("skips spam and trash mailbox names", () => {
    expect(isSkippedMailbox("Junk")).toBe(true);
    expect(isSkippedMailbox("[Gmail]/Spam")).toBe(true);
    expect(isSkippedMailbox("INBOX", ["\\Trash"])).toBe(true);
    expect(isSkippedMailbox("INBOX")).toBe(false);
    expect(isSkippedMailbox("Sent")).toBe(false);
  });

  it("download payload notes skipped attachments", () => {
    const payload = mailDownloadPayload({
      id: "x",
      from: "a@b.c",
      to: "d@e.f",
      subject: "Files",
      date: "today",
      body: "See attached",
      attachments: ["a.docx"],
    });
    expect(payload.markdown).toContain("Attachments skipped: a.docx");
    expect(payload.buffer.toString("utf8")).toContain("See attached");
  });
});
