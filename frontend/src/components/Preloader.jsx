import LoadingState from "@/components/ui/21st/LoadingState";

export default function PreLoader() {
  return <LoadingState size="grid" variant="drive" label="Loading" />;
}

export function FullScreenLoader() {
  return (
    <div
      id="preloader"
      className="fixed left-0 top-0 z-999999 flex h-screen w-screen items-center justify-center bg-theme-bg-primary"
    >
      <LoadingState variant="drive" label="Loading" />
    </div>
  );
}
