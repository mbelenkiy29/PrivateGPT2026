import { API_BASE } from "@/utils/constants";
import { baseHeaders } from "@/utils/request";

const MailDrafts = {
  /**
   * List pending Gmail and Outlook drafts created via agent skills.
   * Always resolves; missing auth comes back as empty arrays with errors.
   * @returns {Promise<{gmail: object[], outlook: object[], errors: {gmail: string|null, outlook: string|null}}>}
   */
  list: async function () {
    return await fetch(`${API_BASE}/mail-drafts`, {
      method: "GET",
      headers: baseHeaders(),
    })
      .then((res) => res.json())
      .catch((e) => {
        console.error(e);
        return {
          gmail: [],
          outlook: [],
          errors: { gmail: "not connected", outlook: "not connected" },
        };
      });
  },
};

export default MailDrafts;
