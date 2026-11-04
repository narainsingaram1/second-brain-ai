import { ReactNode, KeyboardEventHandler, useEffect, useRef } from "react";
interface Props {
  children: ReactNode;
  label: string;
  onClose: () => void;
  className?: string;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
}
const focusable =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"], [contenteditable="true"]';
/** Shared keyboard and focus behavior for workspace dialogs. */
export function DialogBackdrop({
  children,
  label,
  onClose,
  className = "",
  onKeyDown,
}: Props) {
  const root = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const frame = requestAnimationFrame(() => {
      const first = root.current?.querySelector<HTMLElement>(
        '[autofocus], input:not([type="hidden"]), textarea, button',
      );
      (first || root.current)?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      tabIndex={-1}
      className={`workspace-overlay ${className}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close.current();
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          close.current();
        }
        if (event.key === "Tab") {
          const controls = Array.from(
            root.current?.querySelectorAll<HTMLElement>(focusable) || [],
          ).filter((node) => node.getClientRects().length > 0);
          const first = controls[0],
            last = controls[controls.length - 1];
          if (!first) {
            event.preventDefault();
            return;
          }
          if (
            event.shiftKey &&
            (document.activeElement === first ||
              document.activeElement === root.current)
          ) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      }}
    >
      {children}
    </div>
  );
}
