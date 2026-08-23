import ConnectorImages from "@/components/DataConnectorOption/media";
import { useTranslation } from "react-i18next";
import SearchInput from "@/components/ui/21st/SearchInput";
import GithubOptions from "./Connectors/Github";
import GitlabOptions from "./Connectors/Gitlab";
import GiteaOptions from "./Connectors/Gitea";
import YoutubeOptions from "./Connectors/Youtube";
import ConfluenceOptions from "./Connectors/Confluence";
import DrupalWikiOptions from "./Connectors/DrupalWiki";
import { useState } from "react";
import ConnectorOption from "./ConnectorOption";
import WebsiteDepthOptions from "./Connectors/WebsiteDepth";
import ObsidianOptions from "./Connectors/Obsidian";
import PaperlessNgxOptions from "./Connectors/PaperlessNgx";

export const getDataConnectors = (t) => ({
  github: {
    name: t("connectors.github.name"),
    image: ConnectorImages.github,
    description: t("connectors.github.description"),
    options: <GithubOptions />,
  },
  gitlab: {
    name: t("connectors.gitlab.name"),
    image: ConnectorImages.gitlab,
    description: t("connectors.gitlab.description"),
    options: <GitlabOptions />,
  },
  gitea: {
    name: t("connectors.gitea.name"),
    image: ConnectorImages.gitea,
    description: t("connectors.gitea.description"),
    options: <GiteaOptions />,
  },
  "youtube-transcript": {
    name: t("connectors.youtube.name"),
    image: ConnectorImages.youtube,
    description: t("connectors.youtube.description"),
    options: <YoutubeOptions />,
  },
  "website-depth": {
    name: t("connectors.website-depth.name"),
    image: ConnectorImages.websiteDepth,
    description: t("connectors.website-depth.description"),
    options: <WebsiteDepthOptions />,
  },
  confluence: {
    name: t("connectors.confluence.name"),
    image: ConnectorImages.confluence,
    description: t("connectors.confluence.description"),
    options: <ConfluenceOptions />,
  },
  drupalwiki: {
    name: "Drupal Wiki",
    image: ConnectorImages.drupalwiki,
    description: "Import Drupal Wiki spaces in a single click.",
    options: <DrupalWikiOptions />,
  },
  obsidian: {
    name: "Obsidian",
    image: ConnectorImages.obsidian,
    description: "Import Obsidian vault in a single click.",
    options: <ObsidianOptions />,
  },
  "paperless-ngx": {
    name: "Paperless-ngx",
    image: ConnectorImages.paperlessNgx,
    description: "Import documents from your Paperless-ngx instance.",
    options: <PaperlessNgxOptions />,
  },
});

export default function DataConnectors() {
  const { t } = useTranslation();
  const [selectedConnector, setSelectedConnector] = useState("github");
  const [searchQuery, setSearchQuery] = useState("");
  const DATA_CONNECTORS = getDataConnectors(t);

  const filteredConnectors = Object.keys(DATA_CONNECTORS).filter((slug) =>
    DATA_CONNECTORS[slug].name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex upload-modal relative h-[70vh] w-[70vw] max-w-full">
      <div className="w-full p-4 top-0 z-20 overflow-y-auto h-full">
        <div className="w-full flex items-center sticky top-0 z-50 bg-theme-bg-secondary pb-2">
          <SearchInput
            className="w-full"
            inputClassName="h-[38px]"
            placeholder={t("connectors.search-placeholder")}
            autoComplete="off"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className="mt-2 flex flex-col gap-y-2">
          {filteredConnectors.length > 0 ? (
            filteredConnectors.map((slug, index) => (
              <ConnectorOption
                key={index}
                slug={slug}
                selectedConnector={selectedConnector}
                setSelectedConnector={setSelectedConnector}
                image={DATA_CONNECTORS[slug].image}
                name={DATA_CONNECTORS[slug].name}
                description={DATA_CONNECTORS[slug].description}
              />
            ))
          ) : (
            <div className="text-white text-center mt-4">
              {t("connectors.no-connectors")}
            </div>
          )}
        </div>
      </div>
      <div className="xl:block hidden absolute left-1/2 top-0 bottom-0 w-[0.5px] bg-white/20 -translate-x-1/2"></div>
      <div className="w-full p-4 pb-8 top-0 text-white min-w-[500px] overflow-y-auto h-full">
        {DATA_CONNECTORS[selectedConnector].options}
      </div>
    </div>
  );
}
