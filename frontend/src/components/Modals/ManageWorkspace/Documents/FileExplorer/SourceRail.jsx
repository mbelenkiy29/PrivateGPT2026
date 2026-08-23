import { Desktop, Cloud, GoogleLogo } from "@phosphor-icons/react";
import PillTabs from "@/components/ui/21st/PillTabs";

const SOURCES = [
  { key: "local", label: "This computer", icon: Desktop },
  { key: "onedrive", label: "OneDrive", icon: Cloud },
  { key: "google-drive", label: "Google Drive", icon: GoogleLogo },
];

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
          const configured =
            src.key === "local" ||
            (src.key === "onedrive"
              ? oauth?.onedrive?.configured
              : oauth?.google?.configured);
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
