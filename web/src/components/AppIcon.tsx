import { useState, type CSSProperties } from "react";
import { appKey, appName, appPrefs } from "../lib";

// Icons that failed to load this session (app key and icon version), so they go straight to the lettered tile.
const missing = new Set<string>();

/**
 * The app's own icon, read from its executable by the backend. Apps Hearth hasn't seen running
 * (imported history, uninstalled games) get a tile with their first letter in the category colour.
 */
export function AppIcon({ app, size = 20, color }: { app: string; size?: number; color?: string }) {
  const key = appKey(app);
  const version = appPrefs(app)?.icon ?? 0;
  const id = `${key}:${version}`;
  const [failedId, setFailedId] = useState<string | null>(() => (missing.has(id) ? id : null));
  const failed = failedId === id;
  const style = { "--size": `${size}px`, "--tint": color ?? "var(--muted)" } as CSSProperties;
  if (failed || !key || key === "private" || key === "unknown")
    return (
      <span className="app-icon app-icon-letter" style={style} aria-hidden="true">
        {appName(app).charAt(0).toUpperCase()}
      </span>
    );
  return (
    <img
      className="app-icon"
      style={style}
      src={`/api/apps/${encodeURIComponent(key)}/icon${version ? `?v=${version}` : ""}`}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => {
        missing.add(id);
        setFailedId(id);
      }}
    />
  );
}
