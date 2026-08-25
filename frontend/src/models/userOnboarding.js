import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

const UserOnboarding = {
  status: async () => {
    return await fetch(`${API_BASE}/user/onboarding`, {
      method: "GET",
      headers: baseHeaders(),
    })
      .then((res) => res.json())
      .catch((error) => ({
        complete: false,
        error: error.message,
        requirements: {},
        workspaces: [],
      }));
  },

  complete: async (data = {}) => {
    return await fetch(`${API_BASE}/user/onboarding/complete`, {
      method: "POST",
      headers: baseHeaders(),
      body: JSON.stringify(data),
    })
      .then((res) => res.json())
      .catch((error) => ({
        success: false,
        error: error.message,
      }));
  },
};

export default UserOnboarding;
