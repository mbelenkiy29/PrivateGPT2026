import React, { useState } from "react";
import Document from "@/models/document";
import {
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalPrimaryButton,
  ModalSecondaryButton,
} from "@/components/lib/Modal";
import Field from "@/components/ui/21st/Field";

export default function NewFolderModal({ closeModal, onCreated }) {
  const [error, setError] = useState(null);
  const [folderName, setFolderName] = useState("");
  const [creating, setCreating] = useState(false);

  const handleCreate = async (e) => {
    e.preventDefault();
    setError(null);
    const name = folderName.trim();
    if (!name || creating) return;

    setCreating(true);
    const { success } = await Document.createFolder(name);
    setCreating(false);
    if (!success) return setError("Failed to create folder");
    onCreated(name);
  };

  return (
    <form onSubmit={handleCreate} className="flex flex-col gap-y-5">
      <ModalHeader title="Create New Folder" onClose={closeModal} />
      <ModalBody>
        <Field
          label="Folder Name"
          name="folderName"
          placeholder="Enter folder name"
          required
          autoComplete="off"
          value={folderName}
          onChange={(e) => setFolderName(e.target.value)}
        />
        {error && <p className="text-red-400 text-sm">Error: {error}</p>}
      </ModalBody>
      <ModalFooter>
        <ModalSecondaryButton onClick={closeModal} type="button">
          Cancel
        </ModalSecondaryButton>
        <ModalPrimaryButton type="submit" disabled={creating}>
          {creating ? "Creating..." : "Create Folder"}
        </ModalPrimaryButton>
      </ModalFooter>
    </form>
  );
}
