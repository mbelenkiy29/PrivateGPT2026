const net = require("net");
const tls = require("tls");
const { isSkippedMailbox } = require("./mail");

function imapQuote(value) {
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function responseComplete(buf, tag) {
  let i = 0;
  while (i < buf.length) {
    const lit = buf.slice(i).match(/\{(\d+)\}\r\n/);
    if (lit && buf.slice(i).indexOf(lit[0]) >= 0) {
      const at = buf.indexOf(lit[0], i);
      if (at === -1) break;
      const start = at + lit[0].length;
      const need = Number(lit[1]);
      if (buf.length < start + need) return false;
      i = start + need;
      continue;
    }
    break;
  }
  return new RegExp(`(^|\\r\\n)${tag} (OK|NO|BAD) `, "m").test(buf);
}

function taggedStatus(buf, tag) {
  const match = buf.match(
    new RegExp(`(?:^|\\r\\n)${tag} (OK|NO|BAD) ?(.*)$`, "m")
  );
  if (!match) return { ok: false, text: "No tagged IMAP response" };
  return {
    ok: match[1] === "OK",
    code: match[1],
    text: (match[2] || "").trim(),
  };
}

function decodeMimeWords(value) {
  if (!value) return "";
  return String(value)
    .replace(
      /=\?([^?]+)\?([bBqQ])\?([^?]+)\?=/g,
      (_all, _charset, enc, text) => {
        try {
          if (enc.toUpperCase() === "B")
            return Buffer.from(text, "base64").toString("utf8");
          return text
            .replace(/_/g, " ")
            .replace(/=([0-9A-Fa-f]{2})/g, (_m, hex) =>
              String.fromCharCode(parseInt(hex, 16))
            );
        } catch {
          return text;
        }
      }
    )
    .replace(/\s+/g, " ")
    .trim();
}

function parseHeaders(raw) {
  const unfolded = String(raw || "")
    .replace(/\r\n[ \t]+/g, " ")
    .replace(/\n[ \t]+/g, " ");
  const headers = {};
  for (const line of unfolded.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx < 1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const val = decodeMimeWords(line.slice(idx + 1).trim());
    headers[key] = headers[key] ? `${headers[key]}, ${val}` : val;
  }
  return headers;
}

function extractTextPart(raw) {
  const text = String(raw || "").replace(/\r\n/g, "\n");
  if (!/Content-Type:\s*multipart/i.test(text) && !text.includes("--"))
    return { body: text.trim(), attachments: [] };

  const boundaryMatch = text.match(/boundary="?([^"\s;]+)"?/i);
  if (!boundaryMatch) return { body: text.trim(), attachments: [] };

  const boundary = boundaryMatch[1];
  const parts = text.split(
    new RegExp(`--${boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)
  );
  const attachments = [];
  let body = "";
  for (const part of parts) {
    if (part === "" || part.startsWith("--")) continue;
    const splitAt = part.search(/\r?\n\r?\n/);
    const rawHeaders = splitAt >= 0 ? part.slice(0, splitAt) : part;
    const rawBody = splitAt >= 0 ? part.slice(splitAt).trim() : "";
    const headers = parseHeaders(rawHeaders);
    const disp = headers["content-disposition"] || "";
    const ctype = headers["content-type"] || "";
    const filename =
      (disp.match(/filename="?([^";]+)"?/i) ||
        ctype.match(/name="?([^";]+)"?/i) ||
        [])[1] || null;
    if (/attachment/i.test(disp) || filename) {
      if (filename) attachments.push(filename);
      continue;
    }
    if (/text\/plain/i.test(ctype) && !body) body = rawBody;
    else if (/text\/html/i.test(ctype) && !body) body = rawBody;
  }
  return { body: body || text.trim(), attachments };
}

function parseFetchBlocks(buf) {
  const items = [];
  const re = /\* \d+ FETCH \(/g;
  let match;
  const starts = [];
  while ((match = re.exec(buf))) starts.push(match.index);
  for (let i = 0; i < starts.length; i++) {
    const chunk = buf.slice(starts[i], starts[i + 1] || buf.length);
    const uidMatch = chunk.match(/UID (\d+)/);
    if (!uidMatch) continue;
    const headerMatch = chunk.match(
      /BODY\[HEADER\.FIELDS \([^)]+\)\](?:\s*<[^>]+>)?\s*\{(\d+)\}\r\n/
    );
    const textMatch = chunk.match(
      /BODY\[TEXT\](?:\s*<[^>]+>)?\s*\{(\d+)\}\r\n/
    );
    let headers = {};
    let body = "";
    let attachments = [];
    if (headerMatch) {
      const start = chunk.indexOf(headerMatch[0]) + headerMatch[0].length;
      headers = parseHeaders(
        chunk.slice(start, start + Number(headerMatch[1]))
      );
    }
    if (textMatch) {
      const start = chunk.indexOf(textMatch[0]) + textMatch[0].length;
      const extracted = extractTextPart(
        chunk.slice(start, start + Number(textMatch[1]))
      );
      body = extracted.body;
      attachments = extracted.attachments;
    }
    items.push({
      id: uidMatch[1],
      uid: uidMatch[1],
      from: headers.from || "",
      to: headers.to || "",
      subject: headers.subject || "",
      date: headers.date || "",
      body,
      attachments,
    });
  }
  return items;
}

function parseListMailboxes(buf) {
  const boxes = [];
  for (const line of String(buf).split(/\r?\n/)) {
    const match = line.match(/^\* LIST \(([^)]*)\) "([^"]*)" (.+)$/);
    if (!match) continue;
    const attrs = match[1].split(/\s+/).filter(Boolean);
    let name = match[3].trim();
    if (name.endsWith("\r")) name = name.slice(0, -1);
    if (name.startsWith('"') && name.endsWith('"'))
      name = name.slice(1, -1).replace(/\\"/g, '"');
    boxes.push({ name, attrs, delim: match[2] });
  }
  return boxes;
}

function parseSearchUids(buf) {
  const match = String(buf).match(/^\* SEARCH(?: (.+))?$/m);
  if (!match || !match[1]) return [];
  return match[1]
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((uid) => String(uid));
}

class ImapSession {
  constructor(config = {}) {
    this.host = config.host;
    this.port = Number(config.port || 993);
    this.user = config.user;
    this.password = config.password;
    this.useTls = config.tls !== false;
    this.timeoutMs = Number(config.timeoutMs || 20000);
    this.socket = null;
    this.tag = 0;
  }

  #nextTag() {
    this.tag += 1;
    return `A${this.tag}`;
  }

  async connect() {
    if (!this.host) throw new Error("IMAP host is required.");
    if (!this.user || !this.password)
      throw new Error("IMAP username and password are required.");

    await new Promise((resolve, reject) => {
      const onError = (err) => reject(err);
      const connectOpts = { host: this.host, port: this.port };
      this.socket = this.useTls
        ? tls.connect({ ...connectOpts, servername: this.host }, () =>
            resolve()
          )
        : net.connect(connectOpts, () => resolve());
      this.socket.setTimeout(this.timeoutMs);
      this.socket.once("error", onError);
      this.socket.once("timeout", () =>
        reject(new Error("IMAP connection timed out"))
      );
    });

    await this.#readGreeting();
    const login = await this.command(
      `LOGIN ${imapQuote(this.user)} ${imapQuote(this.password)}`
    );
    if (!login.ok) throw new Error(`IMAP login failed: ${login.text}`);
  }

  async #readGreeting() {
    const buf = await this.#readUntil((data) =>
      /^\* (OK|PREAUTH|BYE) /m.test(data)
    );
    if (/^\* BYE /m.test(buf))
      throw new Error("IMAP server rejected connection");
  }

  #readUntil(isComplete) {
    return new Promise((resolve, reject) => {
      let data = "";
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("IMAP timed out"));
      }, this.timeoutMs);
      const onData = (chunk) => {
        data += chunk.toString("utf8");
        if (isComplete(data)) {
          cleanup();
          resolve(data);
        }
      };
      const onError = (err) => {
        cleanup();
        reject(err);
      };
      const cleanup = () => {
        clearTimeout(timer);
        this.socket.removeListener("data", onData);
        this.socket.removeListener("error", onError);
      };
      this.socket.on("data", onData);
      this.socket.once("error", onError);
    });
  }

  async command(cmd) {
    const tag = this.#nextTag();
    this.socket.write(`${tag} ${cmd}\r\n`);
    const buf = await this.#readUntil((data) => responseComplete(data, tag));
    const status = taggedStatus(buf, tag);
    return { ...status, raw: buf };
  }

  async listMailboxes() {
    const result = await this.command(
      `LIST ${imapQuote("")} ${imapQuote("*")}`
    );
    if (!result.ok) throw new Error(`IMAP LIST failed: ${result.text}`);
    return parseListMailboxes(result.raw);
  }

  async select(mailbox) {
    const result = await this.command(`SELECT ${imapQuote(mailbox)}`);
    if (!result.ok)
      throw new Error(`IMAP SELECT ${mailbox} failed: ${result.text}`);
    return result;
  }

  async searchUids({ afterUid } = {}) {
    const criteria =
      afterUid && Number(afterUid) > 0
        ? `UID ${Number(afterUid) + 1}:*`
        : "ALL";
    const result = await this.command(`UID SEARCH ${criteria}`);
    if (!result.ok) throw new Error(`IMAP SEARCH failed: ${result.text}`);
    return parseSearchUids(result.raw);
  }

  async fetch(uids) {
    if (!uids.length) return [];
    const set = uids.join(",");
    const result = await this.command(
      `UID FETCH ${set} (UID FLAGS BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE)] BODY.PEEK[TEXT])`
    );
    if (!result.ok) throw new Error(`IMAP FETCH failed: ${result.text}`);
    return parseFetchBlocks(result.raw);
  }

  async end() {
    if (!this.socket) return;
    try {
      await this.command("LOGOUT");
    } catch {}
    try {
      this.socket.destroy();
    } catch {}
    this.socket = null;
  }
}

function foldersToFetch(boxes, { includeSent = false } = {}) {
  const usable = boxes.filter((box) => !isSkippedMailbox(box.name, box.attrs));
  const names = [];
  const inbox = usable.find((box) => box.name.toUpperCase() === "INBOX");
  names.push(inbox?.name || "INBOX");
  if (includeSent) {
    const sent = usable.find((box) =>
      /(^|\/)sent( items| mail)?$/i.test(box.name)
    );
    if (sent && !names.includes(sent.name)) names.push(sent.name);
  }
  return names;
}

/**
 * List new messages since last UID cursor. Cursor is JSON `{ mailbox: uid }` or a plain INBOX uid.
 */
async function listImapMessages(
  config = {},
  { cursor = null, limit = 200 } = {}
) {
  const { parseJsonCursor } = require("./mail");
  const session = new ImapSession(config);
  await session.connect();
  try {
    let boxes = [];
    try {
      boxes = await session.listMailboxes();
    } catch {
      boxes = [{ name: "INBOX", attrs: [] }];
    }
    const folders = foldersToFetch(boxes, {
      includeSent: !!config.includeSent,
    });
    const cursorMap = parseJsonCursor(cursor, "INBOX");
    const items = [];
    const nextCursor = { ...cursorMap };
    for (const folder of folders) {
      if (items.length >= limit) break;
      await session.select(folder);
      const afterUid = Number(cursorMap[folder] || cursorMap.INBOX || 0) || 0;
      const uids = (await session.searchUids({ afterUid }))
        .map((uid) => Number(uid))
        .filter((uid) => uid > afterUid)
        .sort((a, b) => a - b);
      const batch = uids.slice(0, limit - items.length);
      if (batch.length === 0) continue;
      const fetched = await session.fetch(batch.map(String));
      for (const msg of fetched) {
        items.push({ ...msg, folder, id: String(msg.uid) });
      }
      const maxUid = batch[batch.length - 1];
      if (maxUid) nextCursor[folder] = String(maxUid);
    }
    return { items, cursor: JSON.stringify(nextCursor) };
  } finally {
    await session.end();
  }
}

module.exports = {
  ImapSession,
  listImapMessages,
  imapQuote,
  parseFetchBlocks,
  parseListMailboxes,
  parseSearchUids,
  foldersToFetch,
};
