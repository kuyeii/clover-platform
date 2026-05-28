import { useEffect } from "react";
import { createPortal } from "react-dom";

type Props = {
  message: string | null;
  onDismiss: () => void;
  durationMs?: number;
};

/** 视口上方居中提示，默认数秒后消失 */
export function Toast({
  message,
  onDismiss,
  durationMs = 4000,
}: Props) {
  useEffect(() => {
    if (!message) return;
    const id = window.setTimeout(onDismiss, durationMs);
    return () => window.clearTimeout(id);
  }, [message, onDismiss, durationMs]);

  if (!message || typeof document === "undefined") return null;

  return createPortal(
    <div
      role="status"
      className="pointer-events-none fixed left-1/2 top-4 z-[200] max-w-[min(calc(100vw-2rem),28rem)] -translate-x-1/2 rounded-full bg-ink px-4 py-2.5 text-center text-sm font-medium text-white shadow-panel "
    >
      {message}
    </div>,
    document.body,
  );
}
