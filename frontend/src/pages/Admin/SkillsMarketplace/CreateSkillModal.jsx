import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { X } from "@phosphor-icons/react";
import Button from "@/components/ui/21st/Button";
import Field from "@/components/ui/21st/Field";
import PillTabs from "@/components/ui/21st/PillTabs";
import paths from "@/utils/paths";

const DEFAULT_HANDLER = `module.exports.runtime = {
  handler: async function (params = {}) {
    this.introspect(\`Running skill with \${JSON.stringify(params)}\`);
    return \`Skill executed. Received: \${JSON.stringify(params)}\`;
  },
};
`;

export default function CreateSkillModal({ open, onClose, onCreate, saving }) {
  const navigate = useNavigate();
  const [mode, setMode] = useState("code");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [handler, setHandler] = useState(DEFAULT_HANDLER);
  const [paramsText, setParamsText] = useState(
    '{\n  "query": { "description": "What to look up", "type": "string" }\n}'
  );

  if (!open) return null;

  const submit = (event) => {
    event.preventDefault();
    if (mode === "flow") {
      navigate(paths.agents.builder());
      return;
    }
    let params = {};
    try {
      params = paramsText.trim() ? JSON.parse(paramsText) : {};
    } catch {
      return onCreate?.({ error: "Parameters must be valid JSON." });
    }
    onCreate?.({
      name,
      description,
      handler,
      params,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="w-full max-w-xl rounded-2xl border border-theme-modal-border bg-theme-bg-secondary shadow-xl max-h-[90vh] overflow-y-auto">
        <header className="flex items-center justify-between px-5 py-4 border-b border-theme-modal-border">
          <div>
            <h2 className="text-sm font-semibold text-theme-text-primary">
              Create a skill
            </h2>
            <p className="text-xs text-theme-text-secondary mt-0.5">
              No-code flow or a local JavaScript plugin.
            </p>
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
          <PillTabs
            value={mode}
            onChange={setMode}
            items={[
              { value: "code", label: "Code skill" },
              { value: "flow", label: "Agent Flow" },
            ]}
          />
          {mode === "flow" ? (
            <p className="text-xs text-theme-text-secondary leading-relaxed">
              Opens the Agent Flow builder. Flows show up in this marketplace
              after you save them.
            </p>
          ) : (
            <>
              <Field
                label="Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Lookup weather"
                required
              />
              <Field
                label="Description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What the agent should use this skill for"
                required
              />
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-theme-text-secondary">
                  Parameters (JSON)
                </span>
                <textarea
                  value={paramsText}
                  onChange={(e) => setParamsText(e.target.value)}
                  rows={5}
                  className="w-full rounded-lg border border-theme-modal-border bg-theme-settings-input-bg px-3 py-2 text-xs font-mono text-theme-text-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-sky-500/20"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-theme-text-secondary">
                  handler.js
                </span>
                <textarea
                  value={handler}
                  onChange={(e) => setHandler(e.target.value)}
                  rows={8}
                  className="w-full rounded-lg border border-theme-modal-border bg-theme-settings-input-bg px-3 py-2 text-xs font-mono text-theme-text-primary focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-sky-500/20"
                />
              </label>
            </>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              {mode === "flow" ? "Open builder" : "Create skill"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
