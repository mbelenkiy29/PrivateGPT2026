const { WorkspaceChats } = require("../../models/workspaceChats");

/**
 * Normalize a client-supplied transcript into the {role, content} history
 * the LLM connectors expect. Drops pending/empty/non-chat rows.
 *
 * @param {object[]} history
 * @param {number} messageLimit - max user+assistant pairs to keep
 * @returns {{ rawHistory: object[], chatHistory: {role:string,content:string,attachments?:object[]}[] }}
 */
function normalizeClientChatHistory(history = [], messageLimit = 20) {
  if (!Array.isArray(history)) return { rawHistory: [], chatHistory: [] };

  const chatHistory = [];
  for (const msg of history) {
    if (!msg || typeof msg.content !== "string") continue;
    if (msg.role !== "user" && msg.role !== "assistant") continue;
    if (!msg.content.trim() || msg.pending) continue;
    const entry = { role: msg.role, content: msg.content };
    if (Array.isArray(msg.attachments) && msg.attachments.length)
      entry.attachments = msg.attachments;
    chatHistory.push(entry);
  }

  const maxMessages = Math.max(2, Number(messageLimit) || 20) * 2;
  return {
    rawHistory: [],
    chatHistory: chatHistory.slice(-maxMessages),
  };
}

/**
 * Convert a client transcript into AIbitat's {from,to,content} history.
 * @param {object[]} history
 * @param {number} limit
 */
function toAgentHistory(history = [], limit = 20) {
  const { chatHistory } = normalizeClientChatHistory(history, limit);
  return chatHistory.map((msg) => {
    if (msg.role === "user") {
      return {
        from: "USER",
        to: "@agent",
        content: msg.content,
        state: "success",
        ...(msg.attachments ? { attachments: msg.attachments } : {}),
      };
    }
    return {
      from: "@agent",
      to: "USER",
      content: msg.content,
      state: "success",
    };
  });
}

async function persistWorkspaceChat(incognito, payload) {
  if (incognito) return { chat: { id: null } };
  return WorkspaceChats.new(payload);
}

module.exports = {
  normalizeClientChatHistory,
  toAgentHistory,
  persistWorkspaceChat,
};
