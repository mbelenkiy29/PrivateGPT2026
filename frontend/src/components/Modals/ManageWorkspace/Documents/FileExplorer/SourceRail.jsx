import {
  Desktop,
  Cloud,
  GoogleLogo,
  Buildings,
  MicrosoftTeamsLogo,
} from "@phosphor-icons/react";
import PillTabs from "@/components/ui/21st/PillTabs";

const SOURCES = [
  { key: "local", label: "This computer", icon: Desktop },
  { key: "onedrive", label: "OneDrive", icon: Cloud },
  { key: "google-drive", label: "Google Drive", icon: GoogleLogo },
  { key: "sharepoint", label: "SharePoint", icon: Buildings },
  { key: "teams-files", label: "Teams files", icon: MicrosoftTeamsLogo },
];

function isConfigured(key, oauth = {}) {
  if (key === "local") return true;
  if (key === "google-drive") return !!oauth?.google?.configured;
  return !!oauth?.onedrive?.configured;
}

export default function SourceRail({
  selected,
  onSelect,
  sources = {},
  oauth = {},
}) {
  return (
    <div className="w-full mb-2">
      <PillTabs
        className="w-full [&>button]:flex-1"
        value={selected}
        onChange={onSelect}
        items={SOURCES.map((src) => {
          const Icon = src.icon;
          const info = sources[src.key] || {};
          const connected = src.key === "local" || !!info.connected;
          const configured = isConfigured(src.key, oauth);
          const hint =
            src.key === "local"
              ? src.label
              : connected
                ? "Connected"
                : configured
                  ? "Connect"
                  : "Needs credentials";
          return {
            value: src.key,
            label: src.label,
            icon: <Icon size={14} className="shrink-0" title={hint} />,
          };
        })}
      />
    </div>
  );
}
