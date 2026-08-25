import useLoginMode from "@/hooks/useLoginMode";
import ChatSettingsMenu from "../ChatSettingsMenu";
import IncognitoToggle from "../IncognitoToggle";

export default function ChatHeaderActions({
  incognito = false,
  onIncognitoToggle,
  history = [],
  workspace = null,
  threadSlug = null,
}) {
  const mode = useLoginMode();
  const hasUserIcon = mode !== null;

  return (
    <div
      className={`absolute top-3 md:top-5 z-30 flex items-center gap-1.5 ${
        hasUserIcon ? "right-[55px] md:right-[67px]" : "right-4 md:right-6"
      }`}
    >
      <IncognitoToggle active={incognito} onToggle={onIncognitoToggle} />
      <ChatSettingsMenu
        clustered
        history={history}
        workspace={workspace}
        threadSlug={threadSlug}
      />
    </div>
  );
}
