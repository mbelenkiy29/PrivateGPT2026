import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

const Tickets = {
  list: async function ({ workspaceId, status, q } = {}) {
    const params = new URLSearchParams();
    if (workspaceId) params.set("workspaceId", workspaceId);
    if (status) params.set("status", status);
    if (q) params.set("q", q);
    const qs = params.toString();
    return await fetch(`${API_BASE}/tickets${qs ? `?${qs}` : ""}`, {
      headers: baseHeaders(),
    })
      .then((res) => res.json())
      .catch(() => ({ tickets: [] }));
  },

  create: async function (data) {
    return await fetch(`${API_BASE}/tickets`, {
      method: "POST",
      headers: baseHeaders(),
      body: JSON.stringify(data),
    })
      .then((res) => res.json())
      .catch((e) => ({ ticket: null, error: e.message }));
  },

  get: async function (id) {
    return await fetch(`${API_BASE}/tickets/${id}`, {
      headers: baseHeaders(),
    })
      .then((res) => res.json())
      .catch(() => ({ ticket: null, runs: [] }));
  },

  update: async function (id, data) {
    return await fetch(`${API_BASE}/tickets/${id}`, {
      method: "PATCH",
      headers: baseHeaders(),
      body: JSON.stringify(data),
    })
      .then((res) => res.json())
      .catch((e) => ({ ticket: null, error: e.message }));
  },

  delete: async function (id) {
    return await fetch(`${API_BASE}/tickets/${id}`, {
      method: "DELETE",
      headers: baseHeaders(),
    })
      .then((res) => res.json())
      .catch(() => ({ success: false }));
  },

  move: async function (id, { status, position }) {
    return await fetch(`${API_BASE}/tickets/${id}/move`, {
      method: "POST",
      headers: baseHeaders(),
      body: JSON.stringify({ status, position }),
    })
      .then((res) => res.json())
      .catch((e) => ({ ticket: null, error: e.message }));
  },

  start: async function (id) {
    return await fetch(`${API_BASE}/tickets/${id}/start`, {
      method: "POST",
      headers: baseHeaders(),
    })
      .then((res) => res.json())
      .catch((e) => ({ success: false, error: e.message }));
  },

  runs: async function (id) {
    return await fetch(`${API_BASE}/tickets/${id}/runs`, {
      headers: baseHeaders(),
    })
      .then((res) => res.json())
      .catch(() => ({ runs: [] }));
  },

  killRun: async function (runId) {
    return await fetch(`${API_BASE}/tickets/runs/${runId}/kill`, {
      method: "POST",
      headers: baseHeaders(),
    })
      .then((res) => res.json())
      .catch((e) => ({ success: false, error: e.message }));
  },

  continueInThread: async function (runId) {
    return await fetch(`${API_BASE}/tickets/runs/${runId}/continue`, {
      method: "POST",
      headers: baseHeaders(),
    })
      .then((res) => res.json())
      .catch((e) => ({
        workspaceSlug: null,
        threadSlug: null,
        error: e.message,
      }));
  },

  availableTools: async function () {
    return await fetch(`${API_BASE}/tickets/available-tools`, {
      headers: baseHeaders(),
    })
      .then((res) => res.json())
      .catch(() => ({ tools: [] }));
  },

  assignees: async function (workspaceId) {
    const params = new URLSearchParams();
    if (workspaceId) params.set("workspaceId", workspaceId);
    return await fetch(`${API_BASE}/tickets/assignees?${params.toString()}`, {
      headers: baseHeaders(),
    })
      .then((res) => res.json())
      .catch(() => ({ assignees: [], multiUser: false }));
  },
};

export default Tickets;
