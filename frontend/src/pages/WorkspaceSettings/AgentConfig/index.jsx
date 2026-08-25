import System from "@/models/system";
import Workspace from "@/models/workspace";
import showToast from "@/utils/toast";
import { castToType } from "@/utils/types";
import { useEffect, useRef, useState } from "react";
import AgentLLMSelection from "./AgentLLMSelection";
import Admin from "@/models/admin";
import paths from "@/utils/paths";
import useUser from "@/hooks/useUser";
import SkillsMarketplace from "@/models/skillsMarketplace";
import Button from "@/components/ui/21st/Button";
import LoadingState from "@/components/ui/21st/LoadingState";
import McpLogo from "@/pages/Admin/SkillsMarketplace/McpLogo";

export default function WorkspaceAgentConfiguration({ workspace }) {
  const { user } = useUser();
  const [settings, setSettings] = useState({});
  const [hasChanges, setHasChanges] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const formEl = useRef(null);

  useEffect(() => {
    async function fetchSettings() {
      const _settings = await System.keys();
      setSettings(_settings ?? {});
      setLoading(false);
    }
    fetchSettings();
  }, []);

  const handleUpdate = async (e) => {
    setSaving(true);
    e.preventDefault();
    const data = {
      workspace: {},
      system: {},
      env: {},
    };

    const form = new FormData(formEl.current);
    for (var [key, value] of form.entries()) {
      if (key.startsWith("system::")) {
        const [_, label] = key.split("system::");
        data.system[label] = String(value);
        continue;
      }

      if (key.startsWith("env::")) {
        const [_, label] = key.split("env::");
        data.env[label] = String(value);
        continue;
      }

      data.workspace[key] = castToType(key, value);
    }

    const { workspace: updatedWorkspace, message } = await Workspace.update(
      workspace.slug,
      data.workspace
    );
    await Admin.updateSystemPreferences(data.system);
    await System.updateSystem(data.env);

    if (!!updatedWorkspace) {
      showToast("Workspace updated!", "success", { clear: true });
    } else {
      showToast(`Error: ${message}`, "error", { clear: true });
    }

    setSaving(false);
    setHasChanges(false);
  };

  if (!workspace || loading) return <LoadingSkeleton />;
  return (
    <div id="workspace-agent-settings-container">
      <form
        ref={formEl}
        onSubmit={handleUpdate}
        onChange={() => setHasChanges(true)}
        id="agent-settings-form"
        className="w-1/2 flex flex-col gap-y-6"
      >
        <AgentLLMSelection
          settings={settings}
          workspace={workspace}
          setHasChanges={setHasChanges}
        />
        {(!user || ["admin", "manager"].includes(user?.role)) && (
          <>
            {!hasChanges && (
              <div className="flex flex-col gap-y-4">
                <WorkspaceSkillsPicker
                  workspace={workspace}
                  isAdmin={!user || user?.role === "admin"}
                />
              </div>
            )}
          </>
        )}

        {hasChanges && (
          <button
            type="submit"
            form="agent-settings-form"
            className="w-fit transition-all duration-300 border border-slate-200 px-5 py-2.5 rounded-lg text-white text-sm items-center flex gap-x-2 hover:bg-slate-200 hover:text-slate-800 focus:ring-gray-800"
          >
            {saving ? "Updating agent..." : "Update workspace agent"}
          </button>
        )}
      </form>
    </div>
  );
}

function WorkspaceSkillsPicker({ workspace, isAdmin }) {
  const [items, setItems] = useState([]);
  const [overrides, setOverrides] = useState({ useGlobal: true });
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    const catalog = await SkillsMarketplace.catalog(workspace.slug);
    setItems(
      (catalog?.items || []).filter(
        (skill) => skill.type !== "hub" && skill.installed !== false
      )
    );
    setOverrides(catalog?.overrides || { useGlobal: true });
    setLoading(false);
  };

  useEffect(() => {
    refresh();
  }, [workspace.slug]);

  const toggle = async (skill) => {
    const result = await SkillsMarketplace.assignToWorkspace({
      slug: workspace.slug,
      id: skill.id,
      type: skill.type,
      enabled: !skill.enabled,
    });
    if (!result?.success)
      return showToast(result?.error || "Could not update skill.", "error");
    await refresh();
  };

  const reset = async () => {
    const result = await SkillsMarketplace.resetWorkspace(workspace.slug);
    if (!result?.success)
      return showToast(result?.error || "Could not reset.", "error");
    showToast("This workspace now uses instance-wide skills.", "success");
    await refresh();
  };

  return (
    <div className="flex flex-col gap-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-theme-text-primary">
          Skills for this workspace
        </p>
        {isAdmin && (
          <a
            href={paths.settings.skillsMarketplace(workspace.slug)}
            className="text-xs text-sky-400 hover:underline"
          >
            Open marketplace
          </a>
        )}
      </div>
      <p className="text-xs text-theme-text-secondary">
        {overrides.useGlobal !== false
          ? "Using instance-wide skills. Toggle one to customize this workflow."
          : "This workspace has its own skill set."}
      </p>
      {loading ? (
        <p className="text-xs text-theme-text-secondary">Loading skills…</p>
      ) : (
        <div className="flex flex-col rounded-xl border border-theme-modal-border divide-y divide-theme-modal-border overflow-hidden max-h-72 overflow-y-auto">
          {items.map((skill) => (
            <button
              key={`${skill.type}:${skill.id}`}
              type="button"
              onClick={() => toggle(skill)}
              className="flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-theme-file-picker-hover"
            >
              <span className="flex items-center gap-2 min-w-0 text-xs text-theme-text-primary">
                {skill.type === "mcp" && <McpLogo id={skill.id} size="sm" />}
                <span className="truncate">{skill.name}</span>
              </span>
              <span
                className={`text-[11px] font-semibold ${
                  skill.enabled ? "text-sky-400" : "text-theme-text-secondary"
                }`}
              >
                {skill.enabled ? "On" : "Off"}
              </span>
            </button>
          ))}
        </div>
      )}
      {overrides.useGlobal === false && (
        <Button size="sm" variant="outline" onClick={reset}>
          Use global skills
        </Button>
      )}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div id="workspace-agent-settings-container">
      <LoadingState size="page" variant="drive" />
    </div>
  );
}
