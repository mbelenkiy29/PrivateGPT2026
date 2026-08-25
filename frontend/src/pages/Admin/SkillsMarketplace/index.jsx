import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { isMobile } from "react-device-detect";
import {
  Plus,
  UploadSimple,
  Storefront,
  PuzzlePiece,
  Package,
} from "@phosphor-icons/react";
import Sidebar from "@/components/SettingsSidebar";
import {
  Button,
  SearchInput,
  PillTabs,
  EmptyState,
} from "@/components/ui/21st";
import SkillsMarketplace from "@/models/skillsMarketplace";
import Workspace from "@/models/workspace";
import showToast from "@/utils/toast";
import paths from "@/utils/paths";
import SkillCard from "./SkillCard";
import CreateSkillModal from "./CreateSkillModal";
import ConnectMcpModal from "./ConnectMcpModal";
import DetailDrawer from "./DetailDrawer";

const TABS = [
  { value: "all", label: "All" },
  { value: "installed", label: "Installed" },
  { value: "builtin", label: "Built-in" },
  { value: "hub", label: "Hub" },
  { value: "imported", label: "My skills" },
  { value: "mcp", label: "MCP" },
];

function matchesTab(skill, tab) {
  if (tab === "all") return true;
  if (tab === "installed")
    return skill.installed && skill.type !== "hub" && skill.enabled;
  if (tab === "imported")
    return skill.type === "imported" || skill.type === "flow";
  return skill.type === tab || skill.category === tab;
}

export default function SkillsMarketplacePage() {
  const [params, setParams] = useSearchParams();
  const workspaceSlug = params.get("workspace") || "";
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");
  const [items, setItems] = useState([]);
  const [overrides, setOverrides] = useState({ useGlobal: true });
  const [hubError, setHubError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [connectSkill, setConnectSkill] = useState(null);
  const [saving, setSaving] = useState(false);
  const [workspaces, setWorkspaces] = useState([]);

  const load = useCallback(async () => {
    setLoading(true);
    const [catalog, list] = await Promise.all([
      SkillsMarketplace.catalog(workspaceSlug),
      Workspace.all(),
    ]);
    if (catalog?.success === false && catalog.error)
      showToast(catalog.error, "error");
    setItems(catalog?.items || []);
    setOverrides(catalog?.overrides || { useGlobal: true });
    setHubError(catalog?.hubError || null);
    setWorkspaces(list || []);
    setLoading(false);
  }, [workspaceSlug]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((skill) => {
      if (!matchesTab(skill, tab)) return false;
      if (!q) return true;
      return (
        skill.name?.toLowerCase().includes(q) ||
        skill.description?.toLowerCase().includes(q) ||
        skill.type?.toLowerCase().includes(q)
      );
    });
  }, [items, tab, query]);

  const scoped = Boolean(workspaceSlug) && overrides.useGlobal === false;

  const toggleSkill = async (skill, enabled) => {
    setTogglingId(skill.id);
    let result;
    if (workspaceSlug) {
      result = await SkillsMarketplace.assignToWorkspace({
        slug: workspaceSlug,
        id: skill.id,
        type: skill.type,
        enabled,
      });
      if (result?.success) setOverrides(result.overrides);
    } else {
      result = await SkillsMarketplace.toggle({
        id: skill.id,
        type: skill.type,
        enabled,
      });
    }
    setTogglingId(null);
    if (!result?.success)
      return showToast(result?.error || "Could not update skill.", "error");
    showToast(
      enabled ? `${skill.name} enabled.` : `${skill.name} disabled.`,
      "success"
    );
    await load();
  };

  const connectMcp = async (skill, values) => {
    setSaving(true);
    const result = await SkillsMarketplace.connectMcp(skill.id, values);
    setSaving(false);
    if (!result?.success)
      return showToast(
        result?.error || "Could not connect MCP server.",
        "error"
      );
    showToast(
      `${skill.name} saved. Enable it when you are ready to start the process.`,
      "success"
    );
    setConnectSkill(null);
    await load();
  };

  const disconnectMcp = async (skill) => {
    if (!window.confirm(`Disconnect "${skill.name}"?`)) return;
    const result = await SkillsMarketplace.disconnectMcp(skill.id);
    if (!result?.success)
      return showToast(result?.error || "Could not disconnect.", "error");
    showToast("MCP server disconnected.", "success");
    setSelected(null);
    await load();
  };

  const createSkill = async (spec) => {
    if (spec?.error) return showToast(spec.error, "error");
    setSaving(true);
    const result = await SkillsMarketplace.create(spec);
    setSaving(false);
    if (!result?.success)
      return showToast(result?.error || "Could not create skill.", "error");
    showToast("Skill created. Enable it to use with @agent.", "success");
    setCreateOpen(false);
    await load();
  };

  const uploadZip = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const result = await SkillsMarketplace.upload(file);
    if (!result?.success)
      return showToast(result?.error || "Could not import zip.", "error");
    showToast("Skill imported. Enable it when you are ready.", "success");
    await load();
  };

  const resetWorkspace = async () => {
    if (!workspaceSlug) return;
    const result = await SkillsMarketplace.resetWorkspace(workspaceSlug);
    if (!result?.success)
      return showToast(result?.error || "Could not reset.", "error");
    showToast("This workspace now uses instance-wide skills.", "success");
    await load();
  };

  return (
    <div className="w-screen h-screen overflow-hidden bg-theme-bg-container flex">
      <Sidebar />
      <div
        style={{ height: isMobile ? "100%" : "calc(100% - 32px)" }}
        className="relative md:ml-[2px] md:mr-[16px] md:my-[16px] md:rounded-[16px] bg-theme-bg-secondary w-full h-full overflow-y-scroll p-4 md:p-0"
      >
        <div className="flex flex-col w-full px-1 md:pl-6 md:pr-8 md:py-6 py-16 gap-5">
          <div className="w-full flex flex-col gap-y-1 pb-4 border-white/10 light:border-theme-sidebar-border border-b-2">
            <p className="text-lg leading-6 font-bold text-theme-text-primary">
              Skills Marketplace
            </p>
            <p className="text-xs leading-[18px] text-theme-text-secondary">
              Browse, add, and create agent skills. Pick the set that fits each
              workspace workflow.
            </p>
          </div>

          <div className="flex flex-col lg:flex-row gap-3 lg:items-center">
            <SearchInput
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search skills"
              className="w-full lg:max-w-sm"
            />
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={workspaceSlug}
                onChange={(e) => {
                  const next = new URLSearchParams(params);
                  if (e.target.value) next.set("workspace", e.target.value);
                  else next.delete("workspace");
                  setParams(next, { replace: true });
                }}
                className="h-8 rounded-full border border-theme-modal-border bg-theme-settings-input-bg px-3 text-xs text-theme-text-primary"
              >
                <option value="">Instance-wide</option>
                {workspaces.map((ws) => (
                  <option key={ws.slug} value={ws.slug}>
                    Workspace: {ws.name}
                  </option>
                ))}
              </select>
              {workspaceSlug && (
                <Button size="sm" variant="ghost" onClick={resetWorkspace}>
                  Use global skills
                </Button>
              )}
              <label className="inline-flex">
                <input
                  type="file"
                  accept=".zip,application/zip"
                  className="hidden"
                  onChange={uploadZip}
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={(e) =>
                    e.currentTarget.parentElement
                      ?.querySelector("input")
                      ?.click()
                  }
                >
                  <UploadSimple size={14} />
                  Upload zip
                </Button>
              </label>
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus size={14} />
                Create
              </Button>
            </div>
          </div>

          {scoped && (
            <p className="text-[11px] text-sky-400">
              Showing skills for this workspace. Enable/disable only changes
              this workflow.
            </p>
          )}
          {hubError && (
            <p className="text-[11px] text-amber-400">
              Hub catalog unavailable ({hubError}). Local skills still load.
            </p>
          )}

          <div className="overflow-x-auto">
            <PillTabs items={TABS} value={tab} onChange={setTab} />
          </div>

          <div className="flex flex-col lg:flex-row gap-4 items-start">
            <div className="flex-1 w-full">
              {loading ? (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div
                      key={i}
                      className="h-[168px] rounded-2xl border border-theme-modal-border bg-theme-settings-input-bg/40 animate-pulse"
                    />
                  ))}
                </div>
              ) : filtered.length === 0 ? (
                <EmptyState
                  title="No skills in this view"
                  description={
                    query
                      ? "Try a different search or category."
                      : tab === "mcp"
                        ? "Connect a curated MCP server so @agent can use its tools."
                        : "Create a skill, upload a zip, or import from the Hub."
                  }
                  icons={[
                    <Storefront key="a" size={18} />,
                    <PuzzlePiece key="b" size={18} />,
                    <Package key="c" size={18} />,
                  ]}
                  action={{
                    label: "Create skill",
                    icon: <Plus size={14} />,
                    onClick: () => setCreateOpen(true),
                  }}
                />
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {filtered.map((skill) => (
                    <SkillCard
                      key={`${skill.type}:${skill.id}`}
                      skill={skill}
                      toggling={togglingId === skill.id}
                      onOpen={setSelected}
                      onToggle={toggleSkill}
                      onInstall={(item) => {
                        if (item.type === "mcp") return setConnectSkill(item);
                        window.location.href = paths.communityHub.importItem(
                          item.importId
                        );
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
            {selected && (
              <DetailDrawer
                skill={selected}
                onClose={() => setSelected(null)}
                onToggle={toggleSkill}
                toggling={togglingId === selected.id}
                workspaces={workspaces}
                workspaceSlug={workspaceSlug}
                onAssign={async (slug, skill, enabled) => {
                  const result = await SkillsMarketplace.assignToWorkspace({
                    slug,
                    id: skill.id,
                    type: skill.type,
                    enabled,
                  });
                  if (!result?.success)
                    return showToast(
                      result?.error || "Could not assign skill.",
                      "error"
                    );
                  showToast(`Added to ${slug}.`, "success");
                }}
                onDeleted={() => {
                  setSelected(null);
                  load();
                }}
                onConnectMcp={setConnectSkill}
                onDisconnectMcp={disconnectMcp}
              />
            )}
          </div>
        </div>
      </div>
      <CreateSkillModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={createSkill}
        saving={saving}
      />
      <ConnectMcpModal
        skill={connectSkill}
        onClose={() => setConnectSkill(null)}
        onConnect={connectMcp}
        saving={saving}
      />
    </div>
  );
}
