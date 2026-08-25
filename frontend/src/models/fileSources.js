import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

const FileSources = {
  list: async () => {
    return await fetch(`${API_BASE}/file-sources`, {
      method: "GET",
      headers: baseHeaders(),
    })
      .then((res) => res.json())
      .catch((e) => {
        console.error(e);
        return { sources: {}, oauth: {}, error: e.message };
      });
  },

  getOAuthConfig: async () => {
    return await fetch(`${API_BASE}/file-sources/oauth-config`, {
      method: "GET",
      headers: baseHeaders(),
    })
      .then((res) => res.json())
      .catch((e) => ({ config: null, error: e.message }));
  },

  saveOAuthConfig: async (config) => {
    return await fetch(`${API_BASE}/file-sources/oauth-config`, {
      method: "POST",
      headers: baseHeaders(),
      body: JSON.stringify(config),
    })
      .then((res) => res.json())
      .catch((e) => ({ success: false, error: e.message }));
  },

  authUrl: async (provider) => {
    return await fetch(`${API_BASE}/file-sources/${provider}/auth-url`, {
      method: "GET",
      headers: baseHeaders(),
    })
      .then((res) => res.json())
      .catch((e) => ({ error: e.message }));
  },

  children: async (id, parent = "root") => {
    return await fetch(
      `${API_BASE}/file-sources/${id}/children?parent=${encodeURIComponent(parent)}`,
      {
        method: "GET",
        headers: baseHeaders(),
      }
    )
      .then((res) => res.json())
      .catch((e) => ({ items: [], error: e.message }));
  },

  search: async (id, q) => {
    return await fetch(
      `${API_BASE}/file-sources/${id}/search?q=${encodeURIComponent(q)}`,
      {
        method: "GET",
        headers: baseHeaders(),
      }
    )
      .then((res) => res.json())
      .catch((e) => ({ items: [], error: e.message }));
  },

  index: async (id, { fileIds, workspaceSlug }) => {
    return await fetch(`${API_BASE}/file-sources/${id}/index`, {
      method: "POST",
      headers: baseHeaders(),
      body: JSON.stringify({ fileIds, workspaceSlug }),
    })
      .then((res) => res.json())
      .catch((e) => ({ success: false, error: e.message }));
  },

  disconnect: async (id) => {
    return await fetch(`${API_BASE}/file-sources/${id}`, {
      method: "DELETE",
      headers: baseHeaders(),
    })
      .then((res) => res.json())
      .catch((e) => ({ success: false, error: e.message }));
  },

  connectPopup: async (provider) => {
    const { url, error } = await FileSources.authUrl(provider);
    if (!url)
      return { success: false, error: error || "Could not start login." };

    return await new Promise((resolve) => {
      const popup = window.open(
        url,
        "privategpt-filesource",
        "width=520,height=720"
      );
      const onMessage = (event) => {
        if (event.data?.type !== "file-source-oauth") return;
        if (event.data.provider && event.data.provider !== provider) return;
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

export default FileSources;
