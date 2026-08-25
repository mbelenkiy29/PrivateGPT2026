import { useState } from "react";
import { X } from "@phosphor-icons/react";
import Button from "@/components/ui/21st/Button";
import Field from "@/components/ui/21st/Field";
import McpLogo from "./McpLogo";

export default function ConnectMcpModal({ skill, onClose, onConnect, saving }) {
  const fields = skill?.fields || [];
  const [values, setValues] = useState({});

  if (!skill) return null;

  const submit = (event) => {
    event.preventDefault();
    onConnect?.(skill, values);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="w-full max-w-md rounded-2xl border border-theme-modal-border bg-theme-bg-secondary shadow-xl">
        <header className="flex items-center justify-between px-5 py-4 border-b border-theme-modal-border">
          <div className="flex items-start gap-3 min-w-0">
            <McpLogo id={skill.id} />
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-theme-text-primary">
                Connect {skill.name}
              </h2>
              <p className="text-xs text-theme-text-secondary mt-0.5">
                This process can run code on this machine. Only connect servers
                you trust.
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={16} />
          </Button>
        </header>
        <form onSubmit={submit} className="p-5 flex flex-col gap-4">
          {skill.risk && (
            <p className="text-[11px] text-amber-400 leading-relaxed">
              {skill.risk}
            </p>
          )}
          {fields.length === 0 ? (
            <p className="text-xs text-theme-text-secondary">
              No API key required. The server will be saved stopped until you
              enable it.
            </p>
          ) : (
            fields.map((field) => (
              <Field
                key={field.key}
                label={field.label}
                type={field.secret ? "password" : "text"}
                required={field.required}
                value={values[field.key] || ""}
                onChange={(e) =>
                  setValues((prev) => ({
                    ...prev,
                    [field.key]: e.target.value,
                  }))
                }
                autoComplete="off"
              />
            ))
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              Connect
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
