import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

const Slack = {
  getOAuthConfig: async () => {
    return await fetch(`${API_BASE}/slack/oauth-config`, {
      method: "GET",
      headers: baseHeaders(),
    })
      .then((res) => res.json())
      .catch((e) => ({ config: null, error: e.message }));
  },

  saveOAuthConfig: async (config) => {
    return await fetch(`${API_BASE}/slack/oauth-config`, {
      method: "POST",
      headers: baseHeaders(),
      body: JSON.stringify(config),
    })
      .then((res) => res.json())
      .catch((e) => ({ success: false, error: e.message }));
  },

  authUrl: async () => {
    return await fetch(`${API_BASE}/slack/auth-url`, {
      method: "GET",
      headers: baseHeaders(),
    })
      .then((res) => res.json())
      .catch((e) => ({ error: e.message }));
  },

  status: async () => {
    return await fetch(`${API_BASE}/slack/status`, {
      method: "GET",
      headers: baseHeaders(),
    })
      .then((res) => res.json())
      .catch((e) => ({
        connected: false,
        sources: [],
        workspaces: [],
        error: e.message,
      }));
  },

  channels: async () => {
    return await fetch(`${API_BASE}/slack/channels`, {
      method: "GET",
      headers: baseHeaders(),
    })
      .then((res) => res.json())
      .catch((e) => ({ channels: [], error: e.message }));
  },

  connect: async ({ workspaceSlug, workspaceId, channels }) => {
    return await fetch(`${API_BASE}/slack/connect`, {
      method: "POST",
      headers: baseHeaders(),
      body: JSON.stringify({ workspaceSlug, workspaceId, channels }),
    })
      .then((res) => res.json())
      .catch((e) => ({ success: false, error: e.message }));
  },

  disconnectSource: async (id) => {
    return await fetch(`${API_BASE}/slack/sources/${id}`, {
      method: "DELETE",
      headers: baseHeaders(),
    })
      .then((res) => res.json())
      .catch((e) => ({ success: false, error: e.message }));
  },

  disconnect: async () => {
    return await fetch(`${API_BASE}/slack/disconnect`, {
      method: "DELETE",
      headers: baseHeaders(),
    })
      .then((res) => res.json())
      .catch((e) => ({ success: false, error: e.message }));
  },

  connectPopup: async () => {
    const { url, error } = await Slack.authUrl();
    if (!url)
      return { success: false, error: error || "Could not start login." };

    return await new Promise((resolve) => {
      const popup = window.open(
        url,
        "privategpt-slack",
        "width=520,height=720"
      );
      const onMessage = (event) => {
        if (event.data?.type !== "slack-oauth") return;
        window.removeEventListener("message", onMessage);
        resolve({
          success: !!event.data.success,
          error: event.data.error || null,
        });
        try {
          popup?.close();
        } catch {}
      };
      window.addEventListener("message", onMessage);
      const timer = setInterval(() => {
        if (popup && !popup.closed) return;
        clearInterval(timer);
        window.removeEventListener("message", onMessage);
        resolve({ success: false, error: "Login window closed." });
      }, 600);
    });
  },
};

export default Slack;
