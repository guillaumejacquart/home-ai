import { AppError, getApp } from "@/services/apps/apps";
import { currentHtml } from "@/services/apps/versions";

// Cache simple : appId -> { updatedAt, dataUrl, at }
const cache = new Map<string, { updatedAt: string; dataUrl: string | null; at: number }>();
const TTL_MS = 60_000;

export async function getAppThumb(userId: string, appId: string): Promise<{ dataUrl: string | null }> {
  const app = await getApp(userId, appId);
  if (!app) throw new AppError("App not found.");
  if (!app.hasUi) return { dataUrl: null };
  const html = await currentHtml(appId);
  if (!html) return { dataUrl: null };

  // Lightpanda has no graphics engine (no rasterizing) — we can't render a server-side PNG.
  // Kept for API compatibility but returns null; the client now uses a lazy iframe (AppThumb).
  const updatedKey = String(app.updatedAt);
  const cached = cache.get(appId);
  if (cached && cached.updatedAt === updatedKey && Date.now() - cached.at < TTL_MS) {
    return { dataUrl: cached.dataUrl };
  }
  cache.set(appId, { updatedAt: updatedKey, dataUrl: null, at: Date.now() });
  return { dataUrl: null };
}
