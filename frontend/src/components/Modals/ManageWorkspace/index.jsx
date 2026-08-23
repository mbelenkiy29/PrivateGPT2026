import React, { useState, useEffect, memo } from "react";
import { X } from "@phosphor-icons/react";
import Button from "@/components/ui/21st/Button";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router-dom";
import Workspace from "../../../models/workspace";
import System from "../../../models/system";
import { isMobileOnly } from "react-device-detect";
import useUser from "../../../hooks/useUser";
import DocumentSettings from "./Documents";
import DataConnectors from "./DataConnectors";
import Modal, {
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalPrimaryButton,
} from "@/components/lib/Modal";
import { EmbeddingProgressProvider } from "@/EmbeddingProgressContext";
import { useModalEscape } from "@/hooks/useModalEscape";
import PillTabs from "@/components/ui/21st/PillTabs";

const noop = () => {};
const ManageWorkspace = ({ hideModal = noop, providedSlug = null }) => {
  const { t } = useTranslation();
  const { slug } = useParams();
  const { user } = useUser();
  const [workspace, setWorkspace] = useState(null);
  const [settings, setSettings] = useState({});
  const [selectedTab, setSelectedTab] = useState("documents");

  useEffect(() => {
    async function getSettings() {
      const _settings = await System.keys();
      setSettings(_settings ?? {});
    }
    getSettings();
  }, []);

  useEffect(() => {
    async function fetchWorkspace() {
      const workspace = await Workspace.bySlug(providedSlug ?? slug);
      setWorkspace(workspace);
    }
    fetchWorkspace();
  }, [providedSlug, slug]);

  if (!workspace) return null;

  if (isMobileOnly) {
    return (
      <Modal isOpen={true} onClose={hideModal} size="md">
        <ModalHeader
          title={`${t("connectors.manage.editing")} "${workspace.name}"`}
          onClose={hideModal}
        />
        <ModalBody>
          <p className="text-zinc-300 light:text-slate-700">
            {t("connectors.manage.desktop-only")}
          </p>
        </ModalBody>
        <ModalFooter className="justify-end">
          <ModalPrimaryButton type="button" onClick={hideModal}>
            {t("connectors.manage.dismiss")}
          </ModalPrimaryButton>
        </ModalFooter>
      </Modal>
    );
  }

  return (
    <div className="w-screen h-screen fixed top-0 left-0 flex justify-center items-center z-99">
      <div className="backdrop h-full w-full absolute top-0 z-10" />
      <div className="relative max-h-[90vh] w-[min(1080px,calc(100vw-48px))] transition duration-300 z-20 overflow-y-auto py-8">
        <div className="relative bg-theme-bg-secondary rounded-2xl shadow-lg border border-theme-modal-border w-full overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-theme-modal-border">
            {user?.role !== "default" ? (
              <ModalTabSwitcher
                selectedTab={selectedTab}
                setSelectedTab={setSelectedTab}
              />
            ) : (
              <span />
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={hideModal}
              aria-label="Close"
            >
              <X size={16} weight="bold" />
            </Button>
          </div>

          {selectedTab === "documents" ? (
            <EmbeddingProgressProvider>
              <DocumentSettings workspace={workspace} />
            </EmbeddingProgressProvider>
          ) : (
            <DataConnectors workspace={workspace} systemSettings={settings} />
          )}
        </div>
      </div>
    </div>
  );
};

export default memo(ManageWorkspace);

const ModalTabSwitcher = ({ selectedTab, setSelectedTab }) => {
  const { t } = useTranslation();
  return (
    <PillTabs
      value={selectedTab}
      onChange={setSelectedTab}
      items={[
        { value: "documents", label: t("connectors.manage.documents") },
        {
          value: "dataConnectors",
          label: t("connectors.manage.data-connectors"),
        },
      ]}
    />
  );
};

export function useManageWorkspaceModal() {
  const { user } = useUser();
  const [showing, setShowing] = useState(false);

  function showModal() {
    if (user?.role !== "default") {
      setShowing(true);
    }
  }

  function hideModal() {
    setShowing(false);
  }

  useModalEscape(showing, hideModal);

  return { showing, showModal, hideModal };
}
