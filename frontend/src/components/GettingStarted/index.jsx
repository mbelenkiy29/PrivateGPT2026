import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CaretDown, Check } from "@phosphor-icons/react";
import { cn, LoadingState } from "@/components/ui/21st";
import Admin from "@/models/admin";
import Slack from "@/models/slack";
import Teams from "@/models/teams";
import Telegram from "@/models/telegram";
import FileSources from "@/models/fileSources";
import useUser from "@/hooks/useUser";
import {
  GETTING_STARTED_TOOLS_SKIPPED,
  GETTING_STARTED_WORKSPACE_SAVED,
} from "@/utils/constants";
import WorkspaceStep from "./WorkspaceStep";
import InviteStep from "./InviteStep";
import ConnectToolsStep from "./ConnectToolsStep";
import {
  completedCount,
  DEFAULT_WORKSPACE_NAME,
  firstIncompleteStep,
  GETTING_STARTED_STEPS,
  isInviteStepDone,
  isToolsStepDone,
  isWorkspaceStepDone,
  STEP_INVITE,
  STEP_TOOLS,
  STEP_WORKSPACE,
} from "./steps";

export function canSeeGettingStarted(user) {
  return Boolean(user && ["admin", "manager"].includes(user.role));
}

function readFlag(key) {
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function writeFlag(key, value) {
  try {
    if (value) window.localStorage.setItem(key, "1");
    else window.localStorage.removeItem(key);
  } catch {
    /* ignore quota / private mode */
  }
}

function sourcesConnected(sources) {
  if (!sources) return false;
  if (Array.isArray(sources)) return sources.length > 0;
  if (typeof sources === "object") return Object.keys(sources).length > 0;
  return false;
}

export default function GettingStarted({
  workspace,
  onWorkspaceChange,
  onInvitesChange,
  gated = false,
  className = "",
}) {
  const { t } = useTranslation();
  const { user } = useUser();
  const [loading, setLoading] = useState(true);
  const [invites, setInvites] = useState([]);
  const [users, setUsers] = useState([]);
  const [connected, setConnected] = useState({
    slack: false,
    teams: false,
    telegram: false,
    drive: false,
  });
  const [workspaceSaved, setWorkspaceSaved] = useState(() =>
    readFlag(GETTING_STARTED_WORKSPACE_SAVED)
  );
  const [toolsSkipped, setToolsSkipped] = useState(() =>
    readFlag(GETTING_STARTED_TOOLS_SKIPPED)
  );
  const [opened, setOpened] = useState(null);
  const openedInitialized = useRef(false);
  const defaultName = t("new-workspace.placeholder") || DEFAULT_WORKSPACE_NAME;

  const load = useCallback(async () => {
    const [inviteList, userList, slack, teams, telegram, files] =
      await Promise.all([
        Admin.invites(),
        Admin.users(),
        Slack.status(),
        Teams.botConfig(),
        Telegram.status(),
        FileSources.list(),
      ]);
    setInvites(inviteList || []);
    setUsers(userList || []);
    setConnected({
      slack: Boolean(slack?.connected),
      teams: Boolean(teams?.config?.active || teams?.active),
      telegram: Boolean(telegram?.active),
      drive: sourcesConnected(files?.sources),
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const anyToolConnected = Object.values(connected).some(Boolean);
  const progress = useMemo(
    () => ({
      [STEP_WORKSPACE]: isWorkspaceStepDone({
        workspace,
        saved: workspaceSaved,
        defaultName,
      }),
      [STEP_INVITE]: isInviteStepDone({ invites, users }),
      [STEP_TOOLS]: isToolsStepDone({
        skipped: toolsSkipped,
        connected: anyToolConnected,
      }),
    }),
    [
      workspace,
      workspaceSaved,
      defaultName,
      invites,
      users,
      toolsSkipped,
      anyToolConnected,
    ]
  );

  useEffect(() => {
    if (loading || openedInitialized.current) return;
    openedInitialized.current = true;
    setOpened(firstIncompleteStep(progress));
  }, [loading, progress]);

  const doneCount = completedCount(progress);
  const allDone = doneCount === GETTING_STARTED_STEPS.length;

  function toggleStep(id) {
    setOpened((current) => (current === id ? null : id));
  }

  function handleWorkspaceSaved() {
    writeFlag(GETTING_STARTED_WORKSPACE_SAVED, true);
    setWorkspaceSaved(true);
    if (!progress[STEP_INVITE]) setOpened(STEP_INVITE);
  }

  function handleSkipTools() {
    writeFlag(GETTING_STARTED_TOOLS_SKIPPED, true);
    setToolsSkipped(true);
  }

  if (!canSeeGettingStarted(user)) return null;

  const steps = [
    {
      id: STEP_WORKSPACE,
      title: t("gettingStarted.workspace.title"),
      content: (
        <WorkspaceStep
          workspace={workspace}
          onWorkspaceChange={onWorkspaceChange}
          onSaved={handleWorkspaceSaved}
          defaultName={defaultName}
        />
      ),
    },
    {
      id: STEP_INVITE,
      title: t("gettingStarted.invite.title"),
      content: (
        <InviteStep
          workspace={workspace}
          invites={invites}
          onInvitesChange={() => {
            load();
            onInvitesChange?.();
          }}
        />
      ),
    },
    {
      id: STEP_TOOLS,
      title: t("gettingStarted.tools.title"),
      content: (
        <ConnectToolsStep connected={connected} onSkip={handleSkipTools} />
      ),
    },
  ];

  return (
    <section
      className={cn(
        "w-full max-w-xl text-left",
        gated && "max-w-none",
        className
      )}
      aria-labelledby="getting-started-heading"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2
            id="getting-started-heading"
            className="text-sm font-semibold text-theme-text-primary"
          >
            {t("gettingStarted.title")}
          </h2>
          <p className="text-xs text-theme-text-secondary mt-0.5">
            {allDone
              ? t("gettingStarted.allDone")
              : t("gettingStarted.progress", {
                  completed: doneCount,
                  total: GETTING_STARTED_STEPS.length,
                })}
          </p>
        </div>
      </div>
      {loading ? (
        <div className="rounded-lg border border-theme-modal-border bg-theme-settings-input-bg/50 py-6">
          <LoadingState size="grid" variant="drive" />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {steps.map((step, index) => {
            const done = progress[step.id];
            const open = opened === step.id;
            return (
              <div
                key={step.id}
                className={cn(
                  "rounded-lg border bg-theme-settings-input-bg/50 px-4 transition-colors",
                  done
                    ? "border-sky-400/40 bg-sky-500/[0.06]"
                    : "border-theme-modal-border"
                )}
              >
                <button
                  type="button"
                  className="flex w-full items-center gap-3 py-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-sky-500/25 rounded-md"
                  aria-expanded={open}
                  onClick={() => toggleStep(step.id)}
                >
                  <span
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                      done
                        ? "bg-sky-500 text-white"
                        : "border-2 border-theme-modal-border bg-theme-bg-primary text-theme-text-secondary"
                    )}
                  >
                    {done ? (
                      <Check className="size-3.5" weight="bold" />
                    ) : (
                      index + 1
                    )}
                  </span>
                  <span className="flex-1 font-medium text-sm text-theme-text-primary">
                    {step.title}
                  </span>
                  <CaretDown
                    className={cn(
                      "size-4 shrink-0 text-theme-text-secondary transition-transform duration-200",
                      open && "rotate-180"
                    )}
                    weight="bold"
                  />
                </button>
                {open ? <div className="pb-4 pl-9">{step.content}</div> : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
