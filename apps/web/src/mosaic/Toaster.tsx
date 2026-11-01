import { LykoFace } from "./ui";
import { useToasts } from "./toast";

export function Toaster() {
  const items = useToasts((s) => s.items);
  const dismiss = useToasts((s) => s.dismiss);
  return (
    <div className="m-toasts" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`m-toast ${t.tone === "warning" || t.tone === "error" ? "m-toast--warn" : ""}`} onClick={() => dismiss(t.id)}>
          <LykoFace mood={t.tone === "error" ? "growling" : t.tone === "warning" ? "alert" : t.tone === "success" ? "proud" : "watching"} scale={1.4} />
          <div>
            <b style={t.tone === "warning" || t.tone === "error" ? { color: "#F2EAD7" } : undefined}>{t.from ? `${t.from} · ` : ""}{t.title}</b>
            {t.description ? <p style={t.tone === "warning" || t.tone === "error" ? { color: "#C9D3E6" } : undefined}>{t.description}</p> : null}
          </div>
        </div>
      ))}
    </div>
  );
}
