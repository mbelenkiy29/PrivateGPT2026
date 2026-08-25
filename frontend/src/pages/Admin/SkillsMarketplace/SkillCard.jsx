import {
  Check,
  FlowArrow,
  Package,
  Plugs,
  PuzzlePiece,
  Storefront,
} from "@phosphor-icons/react";
import Button from "@/components/ui/21st/Button";
import { cn } from "@/components/ui/21st/cn";
import McpLogo from "./McpLogo";

const TYPE_META = {
  builtin: { label: "Built-in", Icon: PuzzlePiece },
  imported: { label: "Local", Icon: Package },
  flow: { label: "Flow", Icon: FlowArrow },
  mcp: { label: "MCP", Icon: Plugs },
  hub: { label: "Hub", Icon: Storefront },
};

export default function SkillCard({
  skill,
  onOpen,
  onToggle,
  onInstall,
  toggling = false,
}) {
  const meta = TYPE_META[skill.type] || TYPE_META.imported;
  const Icon = meta.Icon;
  const needsInstall =
    (skill.type === "hub" || skill.type === "mcp") && !skill.installed;

  return (
    <button
      type="button"
      onClick={() => onOpen?.(skill)}
      className={cn(
        "text-left rounded-2xl border border-theme-modal-border bg-theme-settings-input-bg/50 p-4 flex flex-col gap-3 transition-colors hover:border-sky-400/40 hover:bg-theme-settings-input-bg focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-sky-500/25 min-h-[168px]"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        {skill.type === "mcp" ? (
          <McpLogo id={skill.id} />
        ) : (
          <span className="h-9 w-9 rounded-xl border border-theme-modal-border bg-theme-bg-primary flex items-center justify-center text-sky-400 shrink-0">
            <Icon size={18} weight="duotone" />
          </span>
        )}
        <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full border border-theme-modal-border text-theme-text-secondary">
          {meta.label}
        </span>
      </div>
      <div className="flex flex-col gap-1 min-h-[64px]">
        <h3 className="text-sm font-semibold text-theme-text-primary line-clamp-1">
          {skill.name}
        </h3>
        <p className="text-xs text-theme-text-secondary leading-relaxed line-clamp-3">
          {skill.description || "No description."}
        </p>
      </div>
      <div className="mt-auto flex items-center justify-between gap-2">
        {skill.verified === false && skill.type === "hub" ? (
          <span className="text-[10px] font-medium text-amber-400">
            Unverified
          </span>
        ) : needsInstall ? (
          <span className="text-[11px] text-theme-text-secondary">
            Not connected
          </span>
        ) : skill.enabled ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-sky-400">
            <Check size={12} weight="bold" />
            On
          </span>
        ) : (
          <span className="text-[11px] text-theme-text-secondary">Off</span>
        )}
        {needsInstall ? (
          <Button
            size="sm"
            variant="outline"
            disabled={toggling}
            onClick={(event) => {
              event.stopPropagation();
              onInstall?.(skill);
            }}
          >
            {skill.type === "mcp" ? "Connect" : "Add"}
          </Button>
        ) : (
          <Button
            size="sm"
            variant={skill.enabled ? "secondary" : "primary"}
            disabled={toggling}
            onClick={(event) => {
              event.stopPropagation();
              onToggle?.(skill, !skill.enabled);
            }}
          >
            {skill.enabled ? "Disable" : "Enable"}
          </Button>
        )}
      </div>
    </button>
  );
}
