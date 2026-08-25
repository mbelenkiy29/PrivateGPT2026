import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

const SkillsMarketplace = {
  catalog: async function (workspaceSlug = "") {
    const query = workspaceSlug
      ? `?workspace=${encodeURIComponent(workspaceSlug)}`
      : "";
    return await fetch(`${API_BASE}/skills-marketplace/catalog${query}`, {
      method: "GET",
      headers: baseHeaders(),
    })
      .then((res) => res.json())
      .catch((error) => ({
        success: false,
        items: [],
        error: error.message,
      }));
  },
  create: async function (spec = {}) {
    return await fetch(`${API_BASE}/skills-marketplace/create`, {
      method: "POST",
      headers: baseHeaders(),
      body: JSON.stringify(spec),
    })
      .then((res) => res.json())
      .catch((error) => ({ success: false, error: error.message }));
  },
  upload: async function (file) {
    const form = new FormData();
    form.append("file", file);
    return await fetch(`${API_BASE}/skills-marketplace/upload`, {
      method: "POST",
      headers: baseHeaders(),
      body: form,
    })
      .then((res) => res.json())
      .catch((error) => ({ success: false, error: error.message }));
  },
  toggle: async function ({ id, type, enabled }) {
    return await fetch(`${API_BASE}/skills-marketplace/toggle`, {
      method: "POST",
      headers: baseHeaders(),
      body: JSON.stringify({ id, type, enabled }),
    })
      .then((res) => res.json())
      .catch((error) => ({ success: false, error: error.message }));
  },
  assignToWorkspace: async function ({ slug, id, type, enabled }) {
    return await fetch(`${API_BASE}/skills-marketplace/workspace-assign`, {
      method: "POST",
      headers: baseHeaders(),
      body: JSON.stringify({ slug, id, type, enabled }),
    })
      .then((res) => res.json())
      .catch((error) => ({ success: false, error: error.message }));
  },
  connectMcp: async function (id, values = {}) {
    return await fetch(`${API_BASE}/skills-marketplace/mcp/connect`, {
      method: "POST",
      headers: baseHeaders(),
      body: JSON.stringify({ id, values }),
    })
      .then((res) => res.json())
      .catch((error) => ({ success: false, error: error.message }));
  },
  disconnectMcp: async function (name) {
    return await fetch(`${API_BASE}/skills-marketplace/mcp/disconnect`, {
      method: "POST",
      headers: baseHeaders(),
      body: JSON.stringify({ name }),
    })
      .then((res) => res.json())
      .catch((error) => ({ success: false, error: error.message }));
  },
  resetWorkspace: async function (slug) {
    return await fetch(`${API_BASE}/skills-marketplace/workspace-reset`, {
      method: "POST",
      headers: baseHeaders(),
      body: JSON.stringify({ slug }),
    })
      .then((res) => res.json())
      .catch((error) => ({ success: false, error: error.message }));
  },
};

export default SkillsMarketplace;
