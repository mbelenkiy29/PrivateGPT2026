import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

const Teams = {
  botConfig: async () => {
    return await fetch(`${API_BASE}/channels/teams/config`, {
      method: "GET",
      headers: baseHeaders(),
    })
      .then((res) => res.json())
      .catch((e) => ({ config: null, error: e.message }));
  },

  saveBot: async ({
    microsoftAppId,
    microsoftAppPassword,
    tenantId,
    defaultWorkspace,
    active,
  }) => {
    return await fetch(`${API_BASE}/channels/teams/config`, {
      method: "POST",
      headers: baseHeaders(),
      body: JSON.stringify({
        microsoftAppId,
        microsoftAppPassword,
        tenantId,
        defaultWorkspace,
        active,
      }),
    })
      .then((res) => res.json())
      .catch((e) => ({ success: false, error: e.message }));
  },

  disableBot: async () => {
    return await fetch(`${API_BASE}/channels/teams/disconnect`, {
      method: "POST",
      headers: baseHeaders(),
    })
      .then((res) => res.json())
      .catch((e) => ({ success: false, error: e.message }));
  },
};

export default Teams;
