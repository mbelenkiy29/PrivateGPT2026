import Github from "@lobehub/icons/es/Github/components/Mono";
import Google from "@lobehub/icons/es/Google/components/Color";
import MCP from "@lobehub/icons/es/MCP/components/Mono";
import SlackSvg from "@/media/mcp/slack.svg";
import YoutubeSvg from "@/media/mcp/youtube.svg";
import PostgresSvg from "@/media/mcp/postgres.svg";
import BravePng from "@/pages/Admin/Agents/WebSearchSelection/icons/brave.png";
import MemorySvg from "@/media/mcp/memory.svg";
import FetchSvg from "@/media/mcp/fetch.svg";
import PuppeteerSvg from "@/media/mcp/puppeteer.svg";
import ThinkingSvg from "@/media/mcp/thinking.svg";
import FilesystemSvg from "@/media/mcp/filesystem.svg";
import SqliteSvg from "@/media/mcp/sqlite.svg";
import RemoteSvg from "@/media/mcp/remote.svg";
import { cn } from "@/components/ui/21st/cn";

function ImgLogo({ src, alt, size }) {
  return (
    <img
      src={src}
      alt={alt}
      className={cn("object-contain", size === "sm" ? "h-4 w-4" : "h-6 w-6")}
    />
  );
}

const BY_ID = {
  github: ({ size }) => (
    <Github
      size={size === "sm" ? 16 : 22}
      className="text-theme-text-primary"
    />
  ),
  slack: ({ size }) => <ImgLogo src={SlackSvg} alt="Slack" size={size} />,
  postgres: ({ size }) => (
    <ImgLogo src={PostgresSvg} alt="Postgres" size={size} />
  ),
  "brave-search": ({ size }) => (
    <ImgLogo src={BravePng} alt="Brave Search" size={size} />
  ),
  memory: ({ size }) => <ImgLogo src={MemorySvg} alt="Memory" size={size} />,
  fetch: ({ size }) => <ImgLogo src={FetchSvg} alt="Fetch URL" size={size} />,
  puppeteer: ({ size }) => (
    <ImgLogo src={PuppeteerSvg} alt="Puppeteer" size={size} />
  ),
  "sequential-thinking": ({ size }) => (
    <ImgLogo src={ThinkingSvg} alt="Sequential thinking" size={size} />
  ),
  filesystem: ({ size }) => (
    <ImgLogo src={FilesystemSvg} alt="Filesystem" size={size} />
  ),
  sqlite: ({ size }) => <ImgLogo src={SqliteSvg} alt="SQLite" size={size} />,
  "google-maps": ({ size }) => <Google size={size === "sm" ? 16 : 22} />,
  youtube: ({ size }) => <ImgLogo src={YoutubeSvg} alt="YouTube" size={size} />,
  "remote-http": ({ size }) => (
    <ImgLogo src={RemoteSvg} alt="Remote HTTP MCP" size={size} />
  ),
};

export default function McpLogo({ id, className = "", size = "md" }) {
  const Logo =
    BY_ID[id] ||
    (({ size: logoSize }) => (
      <MCP
        size={logoSize === "sm" ? 16 : 22}
        className="text-theme-text-primary"
      />
    ));
  return (
    <span
      className={cn(
        "rounded-xl border border-theme-modal-border bg-theme-bg-primary flex items-center justify-center shrink-0 overflow-hidden",
        size === "sm" ? "h-6 w-6 rounded-lg" : "h-9 w-9",
        className
      )}
    >
      <Logo size={size} />
    </span>
  );
}
