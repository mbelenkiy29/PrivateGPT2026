import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import showToast from "../../../../../utils/toast";
import { useDropzone } from "react-dropzone";
import FileUploadProgress from "./FileUploadProgress";
import Workspace from "../../../../../models/workspace";
import debounce from "lodash.debounce";
import { getFilesFromUploadEvent } from "../../../../../utils/folderUpload";
import Dropzone from "@/components/ui/21st/Dropzone";
import Input from "@/components/ui/21st/Input";
import Button from "@/components/ui/21st/Button";

/**
 * Fills in a missing protocol so the user can type "example.com/docs" instead
 * of the full URL. Anything already carrying a scheme is left alone.
 * @param {string} value raw input value
 * @returns {string|null} the URL to scrape, or null if it cannot be one
 */
function withProtocol(value = "") {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    new URL(candidate);
    return candidate;
  } catch {
    return null;
  }
}

/**
 * @param {object} props
 * @param {ReturnType<import("../hooks/useUploadQueue").default>} props.queue
 * the upload queue shared with the picker's per-folder drop targets, so both
 * report progress in this one list.
 * @param {() => Promise<void>} props.onUploadComplete called (coalesced) once a
 * burst of file uploads settles, so the picker can hydrate in place.
 * @param {() => Promise<void>} props.onLinkScraped called after a link scrape.
 */
export default function UploadFile({
  workspace,
  queue,
  onUploadComplete,
  onLinkScraped,
}) {
  const { t } = useTranslation();
  const { ready, files, setFiles, enqueueDrop } = queue;
  const [fetchingUrl, setFetchingUrl] = useState(false);

  const handleSendLink = async (e) => {
    e.preventDefault();
    const formEl = e.target;
    const form = new FormData(formEl);
    const link = withProtocol(form.get("link"));
    if (!link) return showToast("Please enter a valid link", "error");

    setFetchingUrl(true);
    const { response, data } = await Workspace.uploadLink(workspace.slug, link);
    if (!response.ok) {
      showToast(`Error uploading link: ${data.error}`, "error");
    } else {
      await onLinkScraped();
      showToast("Link uploaded successfully", "success");
      formEl.reset();
    }
    setFetchingUrl(false);
  };

  // Uploads finish one at a time; coalesce their completions into a single
  // picker sync so a 50-file folder drop does not fire 50 refreshes.
  const syncPicker = useMemo(
    () => debounce(() => onUploadComplete?.(), 750),
    [onUploadComplete]
  );
  useEffect(() => () => syncPicker.cancel(), [syncPicker]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: enqueueDrop,
    disabled: !ready,
    getFilesFromEvent: getFilesFromUploadEvent,
  });

  const dropEmpty = ready !== false && files.length === 0;
  const dropTitle =
    ready === false
      ? t("connectors.upload.processor-offline")
      : t("connectors.upload.click-upload");
  const dropDescription =
    ready === false
      ? t("connectors.upload.processor-offline-desc")
      : t("connectors.upload.file-types");

  return (
    <div className="w-full">
      <Dropzone
        className="w-full"
        compact
        getRootProps={getRootProps}
        getInputProps={getInputProps}
        ready={ready}
        isDragActive={isDragActive}
        empty={dropEmpty || ready === false}
        title={dropTitle}
        description={dropDescription}
      >
        <div className="grid grid-cols-2 gap-2 overflow-auto max-h-[180px] p-1 overflow-y-scroll no-scroll w-full">
          {files.map((file) => (
            <FileUploadProgress
              key={file.uid}
              file={file.file}
              uuid={file.uid}
              setFiles={setFiles}
              slug={workspace.slug}
              rejected={file?.rejected}
              reason={file?.reason}
              folderName={file?.folderName}
              relativePath={file?.relativePath}
              onSettled={syncPicker}
            />
          ))}
        </div>
      </Dropzone>
      <div className="text-center text-theme-text-secondary text-[11px] font-medium w-full py-1.5">
        {t("connectors.upload.or-submit-link")}
      </div>
      <form onSubmit={handleSendLink} className="flex gap-x-2">
        <Input
          disabled={fetchingUrl}
          name="link"
          type="text"
          inputMode="url"
          className="flex-1 h-8"
          placeholder={t("connectors.upload.placeholder-link")}
          autoComplete="off"
        />
        <Button
          type="submit"
          variant="outline"
          size="sm"
          disabled={fetchingUrl}
          loading={fetchingUrl}
        >
          {fetchingUrl
            ? t("connectors.upload.fetching")
            : t("connectors.upload.fetch-website")}
        </Button>
      </form>
      <p className="mt-2 text-center text-theme-text-secondary text-[11px]">
        {t("connectors.upload.privacy-notice")}
      </p>
    </div>
  );
}
