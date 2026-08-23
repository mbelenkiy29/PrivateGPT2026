import React, { useState, useEffect, useRef } from "react";
import {
  Trash,
  DotsThreeVertical,
  TreeView,
  Info,
} from "@phosphor-icons/react";
import { useTranslation } from "react-i18next";
import Modal, { ModalHeader, ModalBody } from "@/components/lib/Modal";

function ActionMenu({
  chatId,
  forkThread,
  isEditing,
  role,
  provenance = null,
  sources = [],
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);
  const menuRef = useRef(null);

  const toggleMenu = () => setOpen(!open);

  const handleFork = () => {
    forkThread(chatId);
    setOpen(false);
  };

  const handleDelete = () => {
    window.dispatchEvent(
      new CustomEvent("delete-message", { detail: { chatId } })
    );
    setOpen(false);
  };

  const handleWhy = () => {
    setOpen(false);
    setWhyOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open]);

  if (!chatId || isEditing || role === "user") return null;

  return (
    <div className="mt-2 -ml-0.5 relative" ref={menuRef}>
      <button
        onClick={toggleMenu}
        className="border-none text-zinc-300 light:text-slate-500 transition-colors duration-200"
        data-tooltip-id="action-menu"
        data-tooltip-content={t("chat_window.more_actions")}
        aria-label={t("chat_window.more_actions")}
      >
        <DotsThreeVertical size={24} weight="bold" />
      </button>
      {open && (
        <div
          data-action-menu-open
          className="absolute -top-1 left-7 mt-1 border-[1.5px] border-white/40 rounded-lg bg-theme-action-menu-bg flex flex-col shadow-[0_4px_14px_rgba(0,0,0,0.25)] text-white z-99"
        >
          <button
            onClick={handleWhy}
            className="border-none rounded-t-lg flex items-center text-white gap-x-2 hover:bg-theme-action-menu-item-hover py-1.5 px-2 transition-colors duration-200 w-full text-left"
          >
            <Info size={18} />
            <span className="text-sm">{t("chat_window.why_this_answer")}</span>
          </button>
          <button
            onClick={handleFork}
            className="border-none flex items-center text-white gap-x-2 hover:bg-theme-action-menu-item-hover py-1.5 px-2 transition-colors duration-200 w-full text-left"
          >
            <TreeView size={18} />
            <span className="text-sm">{t("chat_window.fork")}</span>
          </button>
          <button
            onClick={handleDelete}
            className="border-none flex rounded-b-lg items-center text-white gap-x-2 hover:bg-theme-action-menu-item-hover py-1.5 px-2 transition-colors duration-200 w-full text-left"
          >
            <Trash size={18} />
            <span className="text-sm">{t("chat_window.delete")}</span>
          </button>
        </div>
      )}
      <WhyThisAnswerModal
        isOpen={whyOpen}
        onClose={() => setWhyOpen(false)}
        provenance={provenance}
        sources={sources}
      />
    </div>
  );
}

function WhyThisAnswerModal({ isOpen, onClose, provenance, sources = [] }) {
  const { t } = useTranslation();
  const citationList = provenance?.sources?.length
    ? provenance.sources
    : sources;
  const citations = (Array.isArray(citationList) ? citationList : []).filter(
    Boolean
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md">
      <ModalHeader title={t("chat_window.why_this_answer")} onClose={onClose} />
      <ModalBody>
        <dl className="flex flex-col gap-y-3 text-sm">
          {!provenance ? (
            <p className="text-sm text-theme-text-secondary m-0">
              {t("chat_window.why_this_answer_unavailable")}
            </p>
          ) : (
            <>
              <WhyRow label={t("chat_window.why_destination")}>
                {provenance.local
                  ? t("chat_window.why_local")
                  : t("chat_window.why_cloud")}
              </WhyRow>
              {provenance.provider && (
                <WhyRow label={t("chat_window.why_provider")}>
                  {provenance.provider}
                </WhyRow>
              )}
              {provenance.model && (
                <WhyRow label={t("chat_window.why_model")}>
                  {provenance.model}
                </WhyRow>
              )}
            </>
          )}
          <WhyRow label={t("chat_window.why_citations")}>
            {citations.length === 0 ? (
              t("chat_window.why_no_citations")
            ) : (
              <ul className="list-disc pl-4 flex flex-col gap-y-1">
                {citations.map((source, index) => (
                  <li key={source.id || source.title || index}>
                    {source.title ||
                      source.filename ||
                      source.name ||
                      t("chat_window.document")}
                  </li>
                ))}
              </ul>
            )}
          </WhyRow>
        </dl>
        {provenance?.local === true ? (
          <p className="text-xs text-theme-text-secondary">
            {t("chat_window.why_no_training")}
          </p>
        ) : provenance ? (
          <p className="text-xs text-theme-text-secondary">
            {t("privacy.no_training_cloud")}
          </p>
        ) : null}
      </ModalBody>
    </Modal>
  );
}

function WhyRow({ label, children }) {
  return (
    <div className="flex flex-col gap-y-1">
      <dt className="text-xs font-semibold uppercase tracking-wide text-theme-text-secondary">
        {label}
      </dt>
      <dd className="text-theme-text-primary m-0">{children}</dd>
    </div>
  );
}

export default ActionMenu;
