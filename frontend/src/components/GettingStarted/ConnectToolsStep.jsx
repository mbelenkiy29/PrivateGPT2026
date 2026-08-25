import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  CloudArrowUp,
  SlackLogo,
  TelegramLogo,
  MicrosoftTeamsLogo,
} from "@phosphor-icons/react";
import { Button } from "@/components/ui/21st";
import paths from "@/utils/paths";

const TOOLS = [
  {
    id: "slack",
    href: paths.settings.slackBot(),
    Icon: SlackLogo,
    connectedKey: "slack",
  },
  {
    id: "teams",
    href: paths.settings.teamsBot(),
    Icon: MicrosoftTeamsLogo,
    connectedKey: "teams",
  },
  {
    id: "telegram",
    href: paths.settings.telegram(),
    Icon: TelegramLogo,
    connectedKey: "telegram",
  },
  {
    id: "drive",
    href: paths.settings.cloudDrives(),
    Icon: CloudArrowUp,
    connectedKey: "drive",
  },
];

export default function ConnectToolsStep({ connected = {}, onSkip }) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-theme-text-secondary leading-relaxed">
        {t("gettingStarted.tools.description")}
      </p>
      <ul className="flex flex-col gap-1.5">
        {TOOLS.map(({ id, href, Icon, connectedKey }) => {
          const isConnected = Boolean(connected[connectedKey]);
          return (
            <li key={id}>
              <Link
                to={href}
                className="flex items-center gap-3 rounded-lg border border-theme-modal-border bg-theme-bg-primary px-3 py-2 text-sm text-theme-text-primary hover:bg-theme-file-picker-hover transition-colors"
              >
                <Icon
                  className="h-4 w-4 shrink-0 text-theme-text-secondary"
                  weight="bold"
                />
                <span className="flex-1 font-medium">
                  {t(`gettingStarted.tools.${id}`)}
                </span>
                <span className="text-[11px] text-theme-text-secondary">
                  {isConnected
                    ? t("gettingStarted.tools.connected")
                    : t("gettingStarted.tools.connect")}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      <div>
        <Button type="button" variant="ghost" size="sm" onClick={onSkip}>
          {t("gettingStarted.tools.skip")}
        </Button>
      </div>
    </div>
  );
}
