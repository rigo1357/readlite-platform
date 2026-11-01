import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";

type IconName = "overview" | "check" | "chapters" | "report" | "books" | "users" | "moon" | "sun" | "logout" | "chevron" | "close" | "menu" | "eye" | "eyeOff" | "info";
const paths: Record<IconName, ReactNode> = {
  overview: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  chapters: <><path d="M5 3h14v18H5zM8 8h8M8 12h5M15 16h6M18 13v6" /></>,
  report: <><path d="M5 21V3m0 1h13l-3 5 3 5H5" /></>,
  books: <><path d="M4 4h5v16H4zM10 4h5v16h-5zM16 5l4-1 3 15-4 1z" /></>,
  users: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 5" /></>,
  moon: <path d="M21 13a9 9 0 1 1-10-10 7 7 0 0 0 10 10Z" />,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>,
  logout: <><path d="M9 4H4v16h5M9 12h12m-4-4 4 4-4 4" /></>,
  chevron: <path d="m9 5 7 7-7 7" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  menu: <path d="M3 6h18M3 12h18M3 18h18" />,
  eye: <><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
  eyeOff: <><path d="m3 3 18 18M9 5.5A10 10 0 0 1 12 5c6 0 10 7 10 7a19 19 0 0 1-4 4M6 6a22 22 0 0 0-4 6s4 7 10 7a12 12 0 0 0 5-1M10 10a3 3 0 0 0 4 4" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></>,
};
export function AppIcon({ name, className = "" }: { name: IconName; className?: string }) {
  return <svg className={`app-icon ${className}`} aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>;
}
export function WorkspaceHeading({ title, description, children }: { title: string; description: string; children?: ReactNode }) {
  return <header className="workspace-heading"><div><h1>{title}</h1><p>{description}</p></div>{children}</header>;
}
export type ConfirmationOptions = { title: string; description: string; confirmLabel?: string; danger?: boolean; subject?: string };
type Confirm = (options: ConfirmationOptions) => Promise<boolean>;
const ConfirmationContext = createContext<Confirm>(async () => false);
export function useConfirm(): Confirm { return useContext(ConfirmationContext); }
export function ConfirmationDialog({ options, onAnswer }: { options: ConfirmationOptions; onAnswer: (answer: boolean) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) {
      element.showModal();
      element.querySelector<HTMLButtonElement>("[data-confirm-cancel]")?.focus();
    }
    return () => { if (element?.open) element.close(); };
  }, []);
  return <dialog className="confirmation-dialog" ref={dialog} aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} onCancel={(event) => { event.preventDefault(); onAnswer(false); }}>
    <div className="dialog-heading"><h2 id={`${id}-title`}>{options.title}</h2><button className="icon-button" aria-label="Đóng xác nhận" onClick={() => onAnswer(false)} type="button"><AppIcon name="close" /></button></div>
    {options.subject && <p className="confirmation-subject">{options.subject}</p>}
    <p id={`${id}-description`} className="confirmation-description">{options.description}</p>
    <div className="dialog-actions"><button autoFocus data-confirm-cancel className="button button-secondary" onClick={() => onAnswer(false)} type="button">Hủy</button><button className={`button ${options.danger ? "button-danger" : "button-primary"}`} onClick={() => onAnswer(true)} type="button">{options.confirmLabel ?? "Xác nhận"}</button></div>
  </dialog>;
}
export function ConfirmationProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmationOptions | null>(null);
  const pending = useRef<((answer: boolean) => void) | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const confirm = useCallback<Confirm>((next) => {
    if (pending.current) return Promise.resolve(false);
    returnFocus.current = typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return new Promise<boolean>((resolve) => { pending.current = resolve; setOptions(next); });
  }, []);
  const finish = useCallback((answer: boolean) => {
    const resolve = pending.current;
    pending.current = null;
    setOptions(null);
    resolve?.(answer);
  }, []);
  useEffect(() => () => { pending.current?.(false); pending.current = null; }, []);
  useEffect(() => {
    if (!options) {
      const element = returnFocus.current;
      returnFocus.current = null;
      if (element?.isConnected) element.focus({ preventScroll: true });
    }
  }, [options]);
  return <ConfirmationContext.Provider value={confirm}>{children}{options && <ConfirmationDialog options={options} onAnswer={finish} />}</ConfirmationContext.Provider>;
}
