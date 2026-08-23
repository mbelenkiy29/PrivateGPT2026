import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

const Trust = {
  summary: async function () {
    return await fetch(`${API_BASE}/trust/summary`, {
      headers: baseHeaders(),
    })
      .then((res) => {
        if (!res.ok) throw new Error("Could not load trust summary.");
        return res.json();
      })
      .catch((e) => {
        console.error(e);
        return null;
      });
  },

  setRetention: async function (days) {
    return await fetch(`${API_BASE}/trust/retention`, {
      method: "PUT",
      headers: baseHeaders(),
      body: JSON.stringify({ days: Number(days) }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok)
          throw new Error(data.error || "Could not update retention.");
        return data;
      })
      .catch((e) => {
        console.error(e);
        return { success: false, error: e.message };
      });
  },

  exportUserData: async function (userId) {
    return await fetch(`${API_BASE}/trust/export/${userId}`, {
      headers: baseHeaders(),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok)
          throw new Error(data.error || "Could not export user data.");
        return data;
      })
      .catch((e) => {
        console.error(e);
        return { error: e.message };
      });
  },

  deleteUserData: async function (userId) {
    return await fetch(`${API_BASE}/trust/user/${userId}/data`, {
      method: "DELETE",
      headers: baseHeaders(),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok)
          throw new Error(data.error || "Could not delete user data.");
        return data;
      })
      .catch((e) => {
        console.error(e);
        return { success: false, error: e.message };
      });
  },
};

export default Trust;
