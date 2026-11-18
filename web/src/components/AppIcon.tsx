import { useState, type CSSProperties } from "react";
import { appKey, appName } from "../lib";

// Apps whose icon failed to load this session, so they go straight to the lettered tile.
const missing = new Set<string>();

/**
 * The app's own icon, read from its executable by the backend. Apps Hearth hasn't seen running
 * (imported history, uninstalled games) get a tile with their first letter in the category colour.
 */
export function AppIcon({ app, size = 20, color }: { app: string; size?: number; color?: string }) {
  const key = appKey(app);
  const [failed, setFailed] = useState(() => missing.has(key));
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
      src={`/api/apps/${encodeURIComponent(key)}/icon`}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => {
        missing.add(key);
        setFailed(true);
      }}
    />
  );
}
