import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

function fetchFailure(message) {
  return {
    gmail: [],
    outlook: [],
    errors: { gmail: null, outlook: null },
    fetchError: message,
  };
}

const MailDrafts = {
  /**
   * List pending Gmail and Outlook drafts created via agent skills.
   * Missing gmail/outlook arrays or a non-OK response are treated as a
   * fetch failure so the UI does not render a false empty inbox.
   * @returns {Promise<{gmail: object[], outlook: object[], errors: {gmail: string|null, outlook: string|null}, fetchError: string|null}>}
   */
  list: async function () {
    try {
      const res = await fetch(`${API_BASE}/mail-drafts`, {
        method: "GET",
        headers: baseHeaders(),
      });

      if (!res.ok) {
        let message = `Request failed (${res.status})`;
        try {
          const body = await res.json();
          if (body?.error) message = body.error;
        } catch {}
        return fetchFailure(message);
      }

      const data = await res.json();
      if (!Array.isArray(data?.gmail) || !Array.isArray(data?.outlook)) {
        return fetchFailure(data?.error || "Invalid response");
      }

      return {
        gmail: data.gmail,
        outlook: data.outlook,
        errors: {
          gmail: data.errors?.gmail ?? null,
          outlook: data.errors?.outlook ?? null,
        },
        fetchError: null,
      };
    } catch (e) {
      console.error(e);
      return fetchFailure(e.message);
    }
  },
};

export default MailDrafts;
