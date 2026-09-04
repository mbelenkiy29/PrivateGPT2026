import { API_BASE } from "@/utils/constants";

const Signup = {
  enabled: async () => {
    return await fetch(`${API_BASE}/signup/enabled`)
      .then((res) => res.json())
      .then((res) => res?.enabled !== false)
      .catch(() => true);
  },
  create: async (body = {}) => {
    return await fetch(`${API_BASE}/signup`, {
      method: "POST",
      body: JSON.stringify(body),
    })
      .then((res) => {
        if (res.status === 429) {
          return {
            valid: false,
            message: "Too many signup attempts. Try again later.",
          };
        }
        return res.json();
      })
      .catch((e) => ({ valid: false, message: e.message }));
  },
};

export default Signup;
