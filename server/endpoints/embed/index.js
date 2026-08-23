const { v4: uuidv4 } = require("uuid");
const { reqBody, multiUserMode, safeJsonParse } = require("../../utils/http");
const { Telemetry } = require("../../models/telemetry");
const { streamChatWithForEmbed } = require("../../utils/chats/embed");
const { EmbedChats } = require("../../models/embedChats");
const { EmbedLead } = require("../../models/embedLead");
const { EmbedHandoff } = require("../../models/embedHandoff");
const {
  validEmbedConfig,
  canRespond,
  setConnectionMeta,
} = require("../../utils/middleware/embedMiddleware");
const {
  convertToChatHistory,
  writeResponseChunk,
} = require("../../utils/helpers/chat/responses");

const DEFAULT_AI_DISCLOSURE =
  "This conversation is handled by an AI assistant.";

function publicSmbConfig(embed = {}) {
  return {
    ai_disclosure: !!embed.ai_disclosure,
    disclosure_text: embed.ai_disclosure ? DEFAULT_AI_DISCLOSURE : null,
    show_handoff: !!embed.show_handoff,
    lead_capture: !!embed.lead_capture,
    grounded_only: !!embed.grounded_only,
    business_hours: safeJsonParse(embed.business_hours_json, null),
  };
}

function formatEmbedTranscript(chats = []) {
  return chats
    .map((chat) => {
      const parsed = safeJsonParse(chat.response, {});
      const answer = typeof parsed?.text === "string" ? parsed.text : "";
      return `User: ${chat.prompt}\nAssistant: ${answer}`;
    })
    .join("\n\n");
}

function embeddedEndpoints(app) {
  if (!app) return;

  app.get(
    "/embed/:embedId/smb-config",
    [validEmbedConfig, canRespond],
    async (_, response) => {
      try {
        const embed = response.locals.embedConfig;
        response.status(200).json(publicSmbConfig(embed));
      } catch (e) {
        console.error(e.message, e);
        response.sendStatus(500).end();
      }
    }
  );

  app.post(
    "/embed/:embedId/lead",
    [validEmbedConfig, canRespond],
    async (request, response) => {
      try {
        const embed = response.locals.embedConfig;
        if (!embed.lead_capture) {
          response
            .status(400)
            .json({ success: false, error: "Lead capture is not enabled." });
          return;
        }

        const {
          name = null,
          email = null,
          last_question = null,
          lastQuestion = null,
          session_id = null,
          sessionId = null,
        } = reqBody(request) || {};

        const lead = await EmbedLead.create({
          embed_id: embed.id,
          name: name ? String(name).trim() : null,
          email: email ? String(email).trim() : null,
          last_question: last_question || lastQuestion || null,
          session_id: sessionId || session_id || null,
        });
        if (!lead) {
          response
            .status(500)
            .json({ success: false, error: "Failed to save lead." });
          return;
        }

        response.status(200).json({ success: true });
      } catch (e) {
        console.error(e.message, e);
        response.sendStatus(500).end();
      }
    }
  );

  app.post(
    "/embed/:embedId/handoff",
    [validEmbedConfig, canRespond],
    async (request, response) => {
      try {
        const embed = response.locals.embedConfig;
        if (!embed.show_handoff) {
          response
            .status(400)
            .json({ success: false, error: "Handoff is not enabled." });
          return;
        }

        const { session_id = null, sessionId = null } = reqBody(request) || {};
        const session = sessionId || session_id;
        if (!session) {
          response
            .status(400)
            .json({ success: false, error: "session_id is required." });
          return;
        }

        const chats = await EmbedChats.forEmbedByUser(embed.id, session);
        const transcript = formatEmbedTranscript(chats);
        const handoff = await EmbedHandoff.create({
          embed_id: embed.id,
          session_id: String(session),
          email_to: embed.handoff_email ?? null,
          transcript,
          status: "open",
        });
        if (!handoff) {
          response
            .status(500)
            .json({ success: false, error: "Failed to save handoff." });
          return;
        }

        // No generic outbound mailer exists; persist the handoff regardless.
        response.status(200).json({ success: true });
      } catch (e) {
        console.error(e.message, e);
        response.sendStatus(500).end();
      }
    }
  );

  app.post(
    "/embed/:embedId/stream-chat",
    [validEmbedConfig, setConnectionMeta, canRespond],
    async (request, response) => {
      try {
        const embed = response.locals.embedConfig;
        const {
          sessionId,
          message,
          // optional keys for override of defaults if enabled.
          prompt = null,
          model = null,
          temperature = null,
          username = null,
        } = reqBody(request);

        response.setHeader("Cache-Control", "no-cache");
        response.setHeader("Content-Type", "text/event-stream");
        response.setHeader("Access-Control-Allow-Origin", "*");
        response.setHeader("Connection", "keep-alive");
        response.flushHeaders();

        await streamChatWithForEmbed(response, embed, message, sessionId, {
          promptOverride: prompt,
          modelOverride: model,
          temperatureOverride: temperature,
          username,
        });
        await Telemetry.sendTelemetry("embed_sent_chat", {
          multiUserMode: multiUserMode(response),
          LLMSelection: process.env.LLM_PROVIDER || "openai",
          Embedder: process.env.EMBEDDING_ENGINE || "inherit",
          VectorDbSelection: process.env.VECTOR_DB || "lancedb",
        });
        response.end();
      } catch (e) {
        console.error(e);
        writeResponseChunk(response, {
          id: uuidv4(),
          type: "abort",
          sources: [],
          textResponse: null,
          close: true,
          error: e.message,
        });
        response.end();
      }
    }
  );

  app.get(
    "/embed/:embedId/:sessionId",
    [validEmbedConfig],
    async (request, response) => {
      try {
        const { sessionId } = request.params;
        const embed = response.locals.embedConfig;
        const history = await EmbedChats.forEmbedByUser(
          embed.id,
          sessionId,
          null,
          null,
          true
        );

        response.status(200).json({ history: convertToChatHistory(history) });
      } catch (e) {
        console.error(e.message, e);
        response.sendStatus(500).end();
      }
    }
  );

  app.delete(
    "/embed/:embedId/:sessionId",
    [validEmbedConfig],
    async (request, response) => {
      try {
        const { sessionId } = request.params;
        const embed = response.locals.embedConfig;

        await EmbedChats.markHistoryInvalid(embed.id, sessionId);
        response.status(200).end();
      } catch (e) {
        console.error(e.message, e);
        response.sendStatus(500).end();
      }
    }
  );
}

module.exports = { embeddedEndpoints, publicSmbConfig };
