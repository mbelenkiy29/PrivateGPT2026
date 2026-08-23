export default function ConnectorOption({
  slug,
  selectedConnector,
  setSelectedConnector,
  image,
  name,
  description,
}) {
  const selected = selectedConnector === slug;
  return (
    <button
      type="button"
      onClick={() => setSelectedConnector(slug)}
      className={`border-none flex text-left gap-x-3.5 items-center py-2 px-4 rounded-xl cursor-pointer w-full transition-colors ${
        selected
          ? "bg-sky-500/10 light:bg-sky-100/70"
          : "hover:bg-theme-file-picker-hover"
      }`}
    >
      <img src={image} alt={name} className="w-[40px] h-[40px] rounded-md" />
      <div className="flex flex-col min-w-0">
        <div className="text-theme-text-primary font-semibold text-[14px]">
          {name}
        </div>
        <p className="text-[12px] text-theme-text-secondary truncate">
          {description}
        </p>
      </div>
    </button>
  );
}
