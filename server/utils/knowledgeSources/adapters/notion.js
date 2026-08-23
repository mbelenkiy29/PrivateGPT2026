const { registerAdapter } = require("../adapter");

const PROVIDER = "notion";
const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";
const ITEM_CAP = 200;
const STALE_AFTER_MS = 3600000; // 1 hour

function isTimestampCursor(cursor) {
  if (!cursor || typeof cursor !== "string") return false;
  const ms = Date.parse(cursor);
  return !Number.isNaN(ms) && cursor.includes("-");
}

function richText(parts = []) {
  return (Array.isArray(parts) ? parts : [])
    .map((part) => {
      let text = part.plain_text ?? part.text?.content ?? "";
      if (!text) return "";
      const ann = part.annotations || {};
      if (ann.code) text = `\`${text}\``;
      if (ann.bold) text = `**${text}**`;
      if (ann.italic) text = `*${text}*`;
      if (ann.strikethrough) text = `~~${text}~~`;
      if (part.href) text = `[${text}](${part.href})`;
      return text;
    })
    .join("");
}

function pageTitle(page = {}) {
  if (page.object === "database")
    return richText(page.title) || page.display_name || "Untitled";
  const props = page.properties || {};
  for (const prop of Object.values(props)) {
    if (prop?.type === "title") return richText(prop.title) || "Untitled";
  }
  return page.title || "Untitled";
}

function propertyPlainText(prop) {
  if (!prop) return "";
  switch (prop.type) {
    case "rich_text":
      return richText(prop.rich_text);
    case "title":
      return richText(prop.title);
    case "number":
      return prop.number == null ? "" : String(prop.number);
    case "select":
      return prop.select?.name || "";
    case "multi_select":
      return (prop.multi_select || []).map((s) => s.name).join(", ");
    case "status":
      return prop.status?.name || "";
    case "date":
      return prop.date?.start || "";
    case "checkbox":
      return prop.checkbox ? "Yes" : "No";
    case "url":
      return prop.url || "";
    case "email":
      return prop.email || "";
    case "phone_number":
      return prop.phone_number || "";
    case "people":
      return (prop.people || []).map((p) => p.name || p.id).join(", ");
    default:
      return "";
  }
}

function propertiesToMarkdown(page) {
  const lines = [];
  for (const [name, prop] of Object.entries(page.properties || {})) {
    if (prop?.type === "title") continue;
    const value = propertyPlainText(prop);
    if (value) lines.push(`**${name}:** ${value}`);
  }
  return lines.join("\n");
}

function renderBlock(block, depth = 0) {
  const indent = "  ".repeat(depth);
  const type = block.type;
  const data = block[type] || {};
  const text = richText(data.rich_text || data.text || []);

  switch (type) {
    case "heading_1":
      return `# ${text}`;
    case "heading_2":
      return `## ${text}`;
    case "heading_3":
      return `### ${text}`;
    case "bulleted_list_item":
      return `${indent}- ${text}`;
    case "numbered_list_item":
      return `${indent}1. ${text}`;
    case "to_do":
      return `${indent}- [${data.checked ? "x" : " "}] ${text}`;
    case "quote":
      return `> ${text}`;
    case "callout":
      return `> ${text}`;
    case "code":
      return `\`\`\`${data.language || ""}\n${text}\n\`\`\``;
    case "divider":
      return "---";
    case "equation":
      return `$$\n${data.expression || ""}\n$$`;
    case "image": {
      const url = data.file?.url || data.external?.url || "";
      const caption = richText(data.caption);
      return url ? `![${caption || "image"}](${url})` : caption;
    }
    case "bookmark":
    case "embed":
    case "link_preview":
    case "pdf":
    case "file":
    case "video": {
      const url = data.url || data.file?.url || data.external?.url || "";
      const caption = richText(data.caption) || url;
      return url ? `[${caption}](${url})` : caption;
    }
    case "child_page":
      return `[${data.title || "Untitled"}](notion://${block.id})`;
    case "child_database":
      return `[${data.title || "Database"}](notion://${block.id})`;
    case "paragraph":
    case "toggle":
    default:
      return text ? `${indent}${text}` : "";
  }
}

function mapPage(page) {
  const id = page.id;
  const archived = Boolean(page.archived);
  return {
    id,
    pageId: id,
    title: pageTitle(page),
    last_edited_time: page.last_edited_time || null,
    created_time: page.created_time || null,
    url: page.url || null,
    type: page.object === "database" ? "database" : "page",
    parentId: page.parent?.page_id || page.parent?.database_id || null,
    archived,
    deleted: archived,
  };
}

function maxEditedTime(items = [], fallback = null) {
  let max = fallback;
  for (const item of items) {
    const t = item.last_edited_time;
    if (!t) continue;
    if (!max || Date.parse(t) > Date.parse(max)) max = t;
  }
  return max || null;
}

function defaultNotionClient(token) {
  return {
    async request(method, path, body) {
      const res = await fetch(`${NOTION_API}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Notion-Version": NOTION_VERSION,
          "Content-Type": "application/json",
        },
        body: body != null ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error(
          data?.message || data?.error || `Notion ${res.status}`
        );
        err.status = res.status;
        err.body = data;
        throw err;
      }
      return data;
    },
  };
}

async function collectChildren(client, blockId) {
  const results = [];
  let cursor = undefined;
  do {
    const qs = cursor
      ? `?page_size=100&start_cursor=${encodeURIComponent(cursor)}`
      : "?page_size=100";
    const data = await client.request(
      "GET",
      `/blocks/${encodeURIComponent(blockId)}/children${qs}`
    );
    results.push(...(data.results || []));
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return results;
}

async function blocksToMarkdown(client, blockId, depth = 0) {
  const blocks = await collectChildren(client, blockId);
  const lines = [];
  for (const block of blocks) {
    const rendered = renderBlock(block, depth);
    if (rendered) lines.push(rendered);
    if (
      block.has_children &&
      !["child_page", "child_database"].includes(block.type)
    ) {
      const nested = await blocksToMarkdown(client, block.id, depth + 1);
      if (nested) lines.push(nested);
    }
  }
  return lines.join("\n");
}

async function queryDatabasePages(client, databaseId, cap) {
  const pages = [];
  let cursor = undefined;
  do {
    const data = await client.request(
      "POST",
      `/databases/${encodeURIComponent(databaseId)}/query`,
      {
        page_size: Math.min(100, cap - pages.length),
        ...(cursor ? { start_cursor: cursor } : {}),
      }
    );
    for (const result of data.results || []) {
      if (result.object === "page") pages.push(result);
      if (pages.length >= cap) return pages;
    }
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor && pages.length < cap);
  return pages;
}

/**
 * Recursive page/database crawl. Stops at ITEM_CAP live pages.
 * Archived pages are omitted unless `includeArchived` (delta); they do not
 * count toward the live cap and are marked `deleted: true`.
 */
async function crawlTree(
  client,
  rootId,
  cap = ITEM_CAP,
  { includeArchived = false } = {}
) {
  const items = [];
  const seen = new Set();
  const queue = [rootId];
  let live = 0;

  while (queue.length && live < cap) {
    const id = queue.shift();
    if (!id || seen.has(id)) continue;
    seen.add(id);

    let node;
    try {
      node = await client.request("GET", `/pages/${encodeURIComponent(id)}`);
    } catch (e) {
      if (e.status === 404) {
        try {
          node = await client.request(
            "GET",
            `/databases/${encodeURIComponent(id)}`
          );
        } catch {
          continue;
        }
      } else {
        throw e;
      }
    }

    if (node.object === "database") {
      const childPages = await queryDatabasePages(client, node.id, cap - live);
      for (const page of childPages) queue.push(page.id);
      continue;
    }

    if (node.archived) {
      if (includeArchived) items.push(mapPage(node));
      continue;
    }

    items.push(mapPage(node));
    live += 1;
    if (live >= cap) break;

    const blocks = await collectChildren(client, node.id);
    for (const block of blocks) {
      if (block.type === "child_page") queue.push(block.id);
      if (block.type === "child_database") queue.push(block.id);
    }
  }

  return items;
}

async function searchPages(
  client,
  { cursor, since, cap = ITEM_CAP, includeArchived = false } = {}
) {
  const items = [];
  let live = 0;
  let next = isTimestampCursor(cursor) ? undefined : cursor || undefined;
  let lastCursor = null;
  let hasMore = true;

  while (hasMore && live < cap) {
    const body = {
      filter: { property: "object", value: "page" },
      sort: { direction: "descending", timestamp: "last_edited_time" },
      page_size: Math.min(100, cap - live),
    };
    if (next) body.start_cursor = next;

    const data = await client.request("POST", "/search", body);
    const results = data.results || [];
    for (const page of results) {
      if (page.object !== "page") continue;
      if (since && page.last_edited_time && page.last_edited_time <= since)
        continue;
      if (page.archived) {
        if (includeArchived) items.push(mapPage(page));
        continue;
      }
      items.push(mapPage(page));
      live += 1;
      if (live >= cap) break;
    }

    hasMore = Boolean(data.has_more);
    next = data.next_cursor || null;
    lastCursor = next;
    // Sorted desc: once we pass `since`, remaining pages are older.
    if (since && results.length) {
      const oldest = results[results.length - 1]?.last_edited_time;
      if (oldest && oldest <= since) {
        hasMore = false;
        lastCursor = null;
      }
    }
  }

  return { items, cursor: lastCursor };
}

function resolveClient(config, token) {
  if (config.client) return config.client;
  if (!token) throw new Error("Notion integration token is required.");
  return defaultNotionClient(token);
}

function createNotionAdapter(config = {}) {
  const tokenOf = (opts = {}) => opts.token || config.token;
  const rootOf = (opts = {}) =>
    opts.folderId || opts.pageId || config.pageId || config.folderId || null;

  return {
    async list(opts = {}) {
      const token = tokenOf(opts);
      const client = resolveClient(config, token);
      const rootId = rootOf(opts);
      const cursor = opts.cursor || null;

      if (rootId) {
        const items = await crawlTree(client, rootId, ITEM_CAP);
        return { items, cursor: maxEditedTime(items, cursor) };
      }

      const since = isTimestampCursor(cursor) ? cursor : null;
      const searched = await searchPages(client, {
        cursor: since ? null : cursor,
        cap: ITEM_CAP,
      });
      return {
        items: searched.items,
        cursor:
          searched.cursor || maxEditedTime(searched.items, cursor) || null,
      };
    },

    async download(item = {}) {
      const token = item.token || config.token;
      const client = resolveClient(config, token);
      const pageId = item.pageId || item.id;
      if (!pageId) throw new Error("Notion page id is required.");

      const page = await client.request(
        "GET",
        `/pages/${encodeURIComponent(pageId)}`
      );
      const title = pageTitle(page);
      const props = propertiesToMarkdown(page);
      const body = await blocksToMarkdown(client, pageId);
      const markdown = [`# ${title}`, props, body].filter(Boolean).join("\n\n");

      return {
        name: `${title}.md`,
        buffer: Buffer.from(markdown, "utf8"),
        mime: "text/markdown",
        remoteId: page.id,
        modifiedAt: page.last_edited_time || null,
        text: markdown,
      };
    },

    /**
     * Remote removals are included in `items` with `deleted: true`
     * (archived Notion pages). The sync job must unembed those.
     */
    async delta(cursor) {
      const token = config.token;
      const client = resolveClient(config, token);
      const rootId = rootOf({});
      const since = isTimestampCursor(cursor) ? cursor : null;

      if (rootId) {
        const crawled = await crawlTree(client, rootId, ITEM_CAP, {
          includeArchived: true,
        });
        const items = since
          ? crawled.filter(
              (item) =>
                item.deleted ||
                (item.last_edited_time && item.last_edited_time > since)
            )
          : crawled;
        return { items, cursor: maxEditedTime(items, cursor) };
      }

      if (since) {
        const searched = await searchPages(client, {
          since,
          cap: ITEM_CAP,
          includeArchived: true,
        });
        return {
          items: searched.items,
          cursor: maxEditedTime(searched.items, cursor),
        };
      }

      const searched = await searchPages(client, {
        cursor: cursor || null,
        cap: ITEM_CAP,
        includeArchived: true,
      });
      return {
        items: searched.items,
        cursor:
          searched.cursor || maxEditedTime(searched.items, cursor) || null,
      };
    },

    watchHint() {
      return { staleAfterMs: STALE_AFTER_MS, poll: true };
    },

    toChunkSource(item = {}) {
      const id = item.pageId || item.id || item.remoteId || "";
      return `notion://${id}`;
    },
  };
}

async function verifyToken(token, client) {
  const api = client || defaultNotionClient(token);
  return api.request("GET", "/users/me");
}

const NotionAdapter = {
  provider: PROVIDER,
  create: createNotionAdapter,
  verifyToken,
  ITEM_CAP,
  STALE_AFTER_MS,
  ...createNotionAdapter({}),
};

registerAdapter(PROVIDER, NotionAdapter);

module.exports = {
  NotionAdapter,
  createNotionAdapter,
  defaultNotionClient,
  verifyToken,
  pageTitle,
  richText,
  blocksToMarkdown,
  renderBlock,
  isTimestampCursor,
  ITEM_CAP,
  STALE_AFTER_MS,
  PROVIDER,
};
