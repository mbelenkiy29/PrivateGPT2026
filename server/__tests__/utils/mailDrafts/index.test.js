/* eslint-env jest */
const gmailLib = require("../../../utils/agents/aibitat/plugins/gmail/lib");
const outlookLib = require("../../../utils/agents/aibitat/plugins/outlook/lib");

jest.mock("../../../utils/agents/aibitat/plugins/gmail/lib", () => ({
  listDrafts: jest.fn(),
  GmailBridge: { isToolAvailable: jest.fn() },
}));

jest.mock("../../../utils/agents/aibitat/plugins/outlook/lib", () => ({
  listDrafts: jest.fn(),
  OutlookBridge: { isToolAvailable: jest.fn() },
}));

const {
  NOT_CONNECTED,
  GMAIL_COMPOSE_URL,
  OUTLOOK_DRAFTS_URL,
  listGmailDrafts,
  listOutlookDrafts,
  listPendingDrafts,
  mapGmailDraft,
  mapOutlookDraft,
} = require("../../../utils/mailDrafts");

describe("mailDrafts", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("mapGmailDraft", () => {
    test("maps two-field Gmail drafts to inbox rows with compose URL", () => {
      const mapped = mapGmailDraft({
        draftId: "r-111",
        messageId: "msg-111",
        to: "ada@example.com",
        subject: "Q3 plan",
        body: "Please review the attached plan.",
        date: "2026-04-01T12:00:00.000Z",
      });

      expect(mapped).toEqual({
        id: "r-111",
        provider: "gmail",
        to: "ada@example.com",
        subject: "Q3 plan",
        snippet: "Please review the attached plan.",
        createdAt: "2026-04-01T12:00:00.000Z",
        openUrl: `${GMAIL_COMPOSE_URL}msg-111`,
      });
    });

    test("prefers the API webLink when present", () => {
      const mapped = mapGmailDraft({
        draftId: "r-222",
        webLink: "https://mail.google.com/mail/u/0/#drafts?compose=custom",
      });
      expect(mapped.openUrl).toBe(
        "https://mail.google.com/mail/u/0/#drafts?compose=custom"
      );
    });
  });

  describe("mapOutlookDraft", () => {
    test("deep-links to the Outlook drafts folder unless webLink is given", () => {
      const mapped = mapOutlookDraft({
        id: "AAMkAGI2",
        to: "bob@example.com",
        subject: "Follow up",
        preview: "Circling back on the proposal",
        lastModified: "2026-04-02T09:30:00.000Z",
      });

      expect(mapped).toEqual({
        id: "AAMkAGI2",
        provider: "outlook",
        to: "bob@example.com",
        subject: "Follow up",
        snippet: "Circling back on the proposal",
        createdAt: "2026-04-02T09:30:00.000Z",
        openUrl: OUTLOOK_DRAFTS_URL,
      });
    });
  });

  describe("listGmailDrafts", () => {
    test("lists two drafts from a mocked Gmail client", async () => {
      gmailLib.listDrafts.mockResolvedValue({
        success: true,
        data: {
          totalDrafts: 2,
          returned: 2,
          drafts: [
            {
              draftId: "r-1",
              messageId: "m-1",
              to: "one@example.com",
              subject: "First draft",
              snippet: "Hello one",
              date: "2026-01-01T00:00:00.000Z",
            },
            {
              draftId: "r-2",
              to: "two@example.com",
              subject: "Second draft",
              body: "Hello two",
              date: "2026-01-02T00:00:00.000Z",
            },
          ],
        },
      });

      const result = await listGmailDrafts();

      expect(gmailLib.listDrafts).toHaveBeenCalledWith(50);
      expect(result.error).toBeNull();
      expect(result.drafts).toHaveLength(2);
      expect(result.drafts[0]).toMatchObject({
        id: "r-1",
        provider: "gmail",
        to: "one@example.com",
        subject: "First draft",
        snippet: "Hello one",
        openUrl: `${GMAIL_COMPOSE_URL}m-1`,
      });
      expect(result.drafts[1]).toMatchObject({
        id: "r-2",
        provider: "gmail",
        to: "two@example.com",
        subject: "Second draft",
        openUrl: `${GMAIL_COMPOSE_URL}r-2`,
      });
    });

    test("returns not connected when Gmail auth/config is missing", async () => {
      gmailLib.listDrafts.mockResolvedValue({
        success: false,
        error:
          "Gmail integration is not configured. Please set the Deployment ID and API Key in the agent settings.",
      });

      await expect(listGmailDrafts()).resolves.toEqual({
        drafts: [],
        error: NOT_CONNECTED,
      });
    });

    test("returns not connected in multi-user mode", async () => {
      gmailLib.listDrafts.mockResolvedValue({
        success: false,
        error:
          "Gmail integration is not available in multi-user mode for security reasons.",
      });

      await expect(listGmailDrafts()).resolves.toEqual({
        drafts: [],
        error: NOT_CONNECTED,
      });
    });
  });

  describe("listOutlookDrafts", () => {
    test("returns not connected when Outlook is unauthenticated", async () => {
      outlookLib.listDrafts.mockResolvedValue({
        success: false,
        error: "Outlook is not authenticated. Please complete the OAuth flow.",
      });

      await expect(listOutlookDrafts()).resolves.toEqual({
        drafts: [],
        error: NOT_CONNECTED,
      });
    });

    test("maps listed Outlook drafts", async () => {
      outlookLib.listDrafts.mockResolvedValue({
        success: true,
        data: {
          count: 1,
          drafts: [
            {
              id: "AAMk-1",
              to: "team@example.com",
              subject: "Status",
              preview: "Weekly status",
              lastModified: "2026-03-01T15:00:00.000Z",
            },
          ],
        },
      });

      const result = await listOutlookDrafts();
      expect(result.error).toBeNull();
      expect(result.drafts).toEqual([
        {
          id: "AAMk-1",
          provider: "outlook",
          to: "team@example.com",
          subject: "Status",
          snippet: "Weekly status",
          createdAt: "2026-03-01T15:00:00.000Z",
          openUrl: OUTLOOK_DRAFTS_URL,
        },
      ]);
    });
  });

  describe("listPendingDrafts", () => {
    test("combines Gmail drafts with a disconnected Outlook account", async () => {
      gmailLib.listDrafts.mockResolvedValue({
        success: true,
        data: {
          drafts: [
            {
              draftId: "r-1",
              to: "one@example.com",
              subject: "First",
              date: "2026-01-01T00:00:00.000Z",
            },
            {
              draftId: "r-2",
              to: "two@example.com",
              subject: "Second",
              date: "2026-01-02T00:00:00.000Z",
            },
          ],
        },
      });
      outlookLib.listDrafts.mockResolvedValue({
        success: false,
        error: "Outlook integration is not configured.",
      });

      const result = await listPendingDrafts();

      expect(result.gmail.drafts).toHaveLength(2);
      expect(result.gmail.error).toBeNull();
      expect(result.outlook).toEqual({
        drafts: [],
        error: NOT_CONNECTED,
      });
    });
  });
});
