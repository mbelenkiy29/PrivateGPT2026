const { log, conclude } = require("./helpers/index.js");
const { v4: uuidv4 } = require("uuid");
const { safeJsonParse } = require("../utils/http");
const {
  agentActionCb,
  SCHEDULED_JOB_TIMEOUT_MS,
} = require("./helpers/scheduled-job-helper.js");
const { Ticket } = require("../models/ticket.js");
const { TicketRun } = require("../models/ticketRun.js");
const { Workspace } = require("../models/workspace.js");

const TICKET_TIMEOUT_MS =
  Number(process.env.TICKET_TIMEOUT_MS) || SCHEDULED_JOB_TIMEOUT_MS;

/** @type {'success' | 'failed' | 'timed_out' | 'not_found' | 'killed' | undefined} */
let status;
let runId = null;

process.on("SIGTERM", async () => {
  status = "killed";
  log("Received SIGTERM, marking ticket run as killed by user");
  if (runId) await TicketRun.kill(runId);
  conclude();
});

process.on("message", async (payload) => {
  const { ticketId, runId: payloadRunId } = payload;
  runId = payloadRunId;
  let timeoutId = null;
  let errorMessage = null;

  try {
    if (!ticketId || !runId) return;

    const ticket = await Ticket.get({ id: Number(ticketId) });
    if (!ticket) {
      log(`Ticket ${ticketId} not found`);
      status = "not_found";
      return;
    }

    const workspace = await Workspace.get({ id: ticket.workspaceId });
    if (!workspace) {
      log(`Workspace ${ticket.workspaceId} not found for ticket ${ticketId}`);
      status = "failed";
      errorMessage = "Workspace not found";
      return;
    }

    const transitioned = await TicketRun.markRunning(runId);
    if (!transitioned) {
      log(
        `Ticket "${ticket.title}" (id=${ticket.id}) is no longer queued, skipping`
      );
      return;
    }

    log(
      `Starting ticket: "${ticket.title}" (id=${ticket.id}) with timeout ${TICKET_TIMEOUT_MS}ms`
    );
    const { handler, thoughts, toolCalls, state } = agentActionCb();
    const run = await TicketRun.get({ id: Number(runId) });
    const invocationUuid = run?.invocationUuid || uuidv4();

    const { EphemeralAgentHandler } = require("../utils/agents/ephemeral.js");
    const agentHandler = await new EphemeralAgentHandler({
      uuid: invocationUuid,
      workspace,
      prompt: Ticket.buildPrompt(ticket),
      userId: ticket.assigneeUserId || ticket.createdByUserId || null,
      threadId: run?.threadId || null,
    }).init();

    const tools = Array.isArray(ticket.tools)
      ? ticket.tools
      : safeJsonParse(ticket.tools, []);
    const createArgs = { handler };
    if (Array.isArray(tools) && tools.length > 0) {
      createArgs.toolOverrides = tools;
    }
    await agentHandler.createAIbitat(createArgs);

    agentHandler.aibitat.requestToolApproval = async () => {
      log("Tool approval requested for ticket run, auto-approving");
      return {
        approved: true,
        message: "Auto-approved by ticket runner.",
      };
    };

    agentHandler.aibitat.onToolCallResult(
      ({ toolName, arguments: args, result }) => {
        toolCalls.push({
          toolName,
          arguments: args,
          result,
          timestamp: Date.now(),
        });
      }
    );

    const startTime = Date.now();
    await Promise.race([
      agentHandler.startAgentCluster(),
      new Promise((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error("TICKET_TIMEOUT")),
          TICKET_TIMEOUT_MS
        );
      }),
    ]).finally(() => {
      if (!timeoutId) return;
      clearTimeout(timeoutId);
      timeoutId = null;
    });
    const duration = Date.now() - startTime;
    const outputs = agentHandler.getPendingOutputs();

    status = "success";
    await TicketRun.complete(runId, {
      result: {
        text: state.textResponse,
        thoughts,
        toolCalls,
        outputs,
        metrics: state.metrics,
        duration,
      },
    });
    await TicketRun.portToThread(runId);
    log(`Ticket "${ticket.title}" completed in ${duration}ms`);
  } catch (error) {
    if (error.message === "TICKET_TIMEOUT") {
      status = "timed_out";
      log("Ticket run timed out");
    } else {
      status = "failed";
      log(`Ticket run error: ${error.message}`);
      errorMessage = error.message;
    }
  } finally {
    switch (status) {
      case "not_found":
        await TicketRun.failIfNotTerminal(runId, "Ticket no longer exists");
        break;
      case "timed_out":
        await TicketRun.timeout(runId);
        break;
      case "failed":
        await TicketRun.fail(runId, { error: errorMessage });
        break;
      default:
        break;
    }

    if (timeoutId) clearTimeout(timeoutId);
    conclude();
  }
});
