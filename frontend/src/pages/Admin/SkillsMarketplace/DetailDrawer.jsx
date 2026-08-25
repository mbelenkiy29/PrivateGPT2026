import { Link } from "react-router-dom";
import { X, Trash } from "@phosphor-icons/react";
import Button from "@/components/ui/21st/Button";
import paths from "@/utils/paths";
import McpLogo from "./McpLogo";
import AgentPlugins from "@/models/experimental/agentPlugins";
import showToast from "@/utils/toast";

export default function DetailDrawer({
  skill,
  onClose,
  onToggle,
  onDeleted,
  workspaces = [],
  workspaceSlug,
  onAssign,
  toggling = false,
  onConnectMcp,
  onDisconnectMcp,
}) {
  if (!skill) return null;

  const configureHref =
    skill.type === "flow"
      ? paths.agents.editAgent(skill.id)
      : skill.type === "hub" && skill.importId
        ? paths.communityHub.importItem(skill.importId)
        : paths.settings.agentSkills();

  const deleteLocal = async () => {
    if (!window.confirm(`Delete "${skill.name}" from this instance?`)) return;
    const ok = await AgentPlugins.deletePlugin(skill.id);
    if (!ok) return showToast("Could not delete skill.", "error");
    showToast("Skill deleted.", "success");
    onDeleted?.(skill);
  };

  return (
    <aside className="w-full lg:w-[360px] shrink-0 rounded-2xl border border-theme-modal-border bg-theme-settings-input-bg/60 p-5 flex flex-col gap-4 max-h-[70vh] overflow-y-auto">
      <header className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-3 min-w-0">
          {skill.type === "mcp" && <McpLogo id={skill.id} />}
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wide font-semibold text-theme-text-secondary">
              {skill.type}
            </p>
            <h2 className="text-base font-semibold text-theme-text-primary">
              {skill.name}
            </h2>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Close"
        >
          <X size={16} />
        </Button>
      </header>
      <p className="text-xs text-theme-text-secondary leading-relaxed">
        {skill.description || "No description."}
      </p>
      {skill.author && (
        <p className="text-[11px] text-theme-text-secondary">
          Author: {skill.author}
        </p>
      )}
      {Array.isArray(skill.examples) && skill.examples.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-theme-text-primary">
            Examples
          </p>
          {skill.examples.slice(0, 3).map((example, index) => (
            <p key={index} className="text-[11px] text-theme-text-secondary">
              {example.prompt || JSON.stringify(example)}
            </p>
          ))}
        </div>
      )}
      {skill.risk && (
        <p className="text-[11px] text-amber-400 leading-relaxed">
          {skill.risk}
        </p>
      )}
      {skill.type === "mcp" && !skill.installed ? (
        <Button onClick={() => onConnectMcp?.(skill)}>Connect MCP</Button>
      ) : skill.type !== "hub" ? (
        <Button
          variant={skill.enabled ? "secondary" : "primary"}
          disabled={toggling}
          onClick={() => onToggle?.(skill, !skill.enabled)}
        >
          {skill.enabled ? "Disable for this view" : "Enable for this view"}
        </Button>
      ) : null}
      {skill.type === "hub" && !skill.installed && (
        <Link
          to={paths.communityHub.importItem(skill.importId)}
          className="text-center text-sm font-semibold rounded-full border border-theme-modal-border px-4 py-2 text-theme-text-primary hover:bg-theme-file-picker-hover"
        >
          Review & import
        </Link>
      )}
      {workspaces.length > 0 && skill.type !== "hub" && (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-theme-text-primary">
            Add to a workspace
          </p>
          <div className="flex flex-wrap gap-1.5">
            {workspaces.map((ws) => (
              <Button
                key={ws.slug}
                size="sm"
                variant={workspaceSlug === ws.slug ? "primary" : "outline"}
                onClick={() => onAssign?.(ws.slug, skill, true)}
              >
                {ws.name}
              </Button>
            ))}
          </div>
        </div>
      )}
      <Link to={configureHref} className="text-xs text-sky-400 hover:underline">
        Advanced settings
      </Link>
      {skill.type === "imported" && (
        <Button variant="destructive" size="sm" onClick={deleteLocal}>
          <Trash size={14} />
          Delete local skill
        </Button>
      )}
      {skill.type === "mcp" && skill.installed && (
        <Button
          variant="destructive"
          size="sm"
          onClick={() => onDisconnectMcp?.(skill)}
        >
          <Trash size={14} />
          Disconnect
        </Button>
      )}
    </aside>
  );
}
