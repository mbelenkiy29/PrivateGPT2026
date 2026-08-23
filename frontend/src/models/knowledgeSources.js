import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

const KnowledgeSources = {
  status: async () => {
    return await fetch(`${API_BASE}/knowledge-sources`, {
      method: "GET",
      headers: baseHeaders(),
    })
      .then((res) => res.json())
      .catch((e) => ({
        notion: { connected: false },
        dropbox: { configured: false, connected: false },
        sources: [],
        workspaces: [],
        error: e.message,
      }));
  },

  saveNotionToken: async (token) => {
    return await fetch(`${API_BASE}/knowledge-sources/notion/token`, {
      method: "POST",
      headers: baseHeaders(),
      body: JSON.stringify({ token }),
    })
      .then((res) => res.json())
      .catch((e) => ({ success: false, error: e.message }));
  },

  notionPages: async ({ parent, cursor } = {}) => {
    const params = new URLSearchParams();
    if (parent) params.set("parent", parent);
    if (cursor) params.set("cursor", cursor);
    const qs = params.toString();
    return await fetch(
      `${API_BASE}/knowledge-sources/notion/pages${qs ? `?${qs}` : ""}`,
      { method: "GET", headers: baseHeaders() }
    )
      .then((res) => res.json())
      .catch((e) => ({ items: [], error: e.message }));
  },

  watchNotion: async ({ pageId, workspaceId, workspaceSlug, display_name }) => {
    return await fetch(`${API_BASE}/knowledge-sources/notion/watch`, {
      method: "POST",
      headers: baseHeaders(),
      body: JSON.stringify({
        pageId,
        workspaceId,
        workspaceSlug,
        display_name,
      }),
    })
      .then((res) => res.json())
      .catch((e) => ({ success: false, error: e.message }));
  },

  saveDropboxOAuthConfig: async (config) => {
    return await fetch(`${API_BASE}/knowledge-sources/dropbox/oauth-config`, {
      method: "POST",
      headers: baseHeaders(),
      body: JSON.stringify(config),
    })
      .then((res) => res.json())
      .catch((e) => ({ success: false, error: e.message }));
  },

  dropboxAuthUrl: async () => {
    return await fetch(`${API_BASE}/knowledge-sources/dropbox/auth-url`, {
      method: "GET",
      headers: baseHeaders(),
    })
      .then((res) => res.json())
      .catch((e) => ({ error: e.message }));
  },

  dropboxFolders: async (path = "") => {
    return await fetch(
      `${API_BASE}/knowledge-sources/dropbox/folders?path=${encodeURIComponent(path)}`,
      { method: "GET", headers: baseHeaders() }
    )
      .then((res) => res.json())
      .catch((e) => ({ items: [], error: e.message }));
  },

  watchDropbox: async ({ path, workspaceId, workspaceSlug, display_name }) => {
    return await fetch(`${API_BASE}/knowledge-sources/dropbox/watch`, {
      method: "POST",
      headers: baseHeaders(),
      body: JSON.stringify({
        path,
        workspaceId,
        workspaceSlug,
        display_name,
      }),
    })
      .then((res) => res.json())
      .catch((e) => ({ success: false, error: e.message }));
  },

  disconnect: async (id) => {
    return await fetch(`${API_BASE}/knowledge-sources/${id}`, {
      method: "DELETE",
      headers: baseHeaders(),
    })
      .then((res) => res.json())
      .catch((e) => ({ success: false, error: e.message }));
  },

  connectDropboxPopup: async () => {
    const {
      url,
      origin: callbackOrigin,
      error,
    } = await KnowledgeSources.dropboxAuthUrl();
    if (!url)
      return {
        success: false,
        error: error || "Could not start Dropbox login.",
      };

    const trustedOrigins = new Set([window.location.origin]);
    try {
      trustedOrigins.add(new URL(API_BASE, window.location.origin).origin);
    } catch {}
    if (callbackOrigin) trustedOrigins.add(callbackOrigin);

    return await new Promise((resolve) => {
      const popup = window.open(
        url,
        "privategpt-dropbox",
        "width=520,height=720"
      );
      const onMessage = (event) => {
        if (!trustedOrigins.has(event.origin)) return;
        if (event.data?.type !== "knowledge-source-oauth") return;
        if (event.data.provider && event.data.provider !== "dropbox") return;
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

export default KnowledgeSources;
