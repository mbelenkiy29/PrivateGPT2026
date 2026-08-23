import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

const EmailInbox = {
  status: async () => {
    return await fetch(`${API_BASE}/admin/email-inbox`, {
      method: "GET",
      headers: baseHeaders(),
    })
      .then((res) => res.json())
      .catch((e) => ({
        sources: [],
        workspaces: [],
        gmail: { connected: false },
        outlook: { connected: false },
        error: e.message,
      }));
  },

  saveImap: async (payload) => {
    return await fetch(`${API_BASE}/admin/email-inbox/imap`, {
      method: "POST",
      headers: baseHeaders(),
      body: JSON.stringify(payload),
    })
      .then((res) => res.json())
      .catch((e) => ({ success: false, error: e.message }));
  },

  useGmail: async (payload) => {
    return await fetch(`${API_BASE}/admin/email-inbox/gmail-mail`, {
      method: "POST",
      headers: baseHeaders(),
      body: JSON.stringify(payload),
    })
      .then((res) => res.json())
      .catch((e) => ({ success: false, error: e.message }));
  },

  useOutlook: async (payload) => {
    return await fetch(`${API_BASE}/admin/email-inbox/outlook-mail`, {
      method: "POST",
      headers: baseHeaders(),
      body: JSON.stringify(payload),
    })
      .then((res) => res.json())
      .catch((e) => ({ success: false, error: e.message }));
  },

  remove: async (id) => {
    return await fetch(`${API_BASE}/admin/email-inbox/${id}`, {
      method: "DELETE",
      headers: baseHeaders(),
    })
      .then((res) => res.json())
      .catch((e) => ({ success: false, error: e.message }));
  },
};

export default EmailInbox;
