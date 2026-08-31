import { z } from "zod";

import type { ConnectionProvider } from "@/services/connections/definition";

const OWM_BASE = "https://api.openweathermap.org/data/2.5";
const OWM_GEO = "https://api.openweathermap.org/geo/1.0";

export const weatherSchema = z.object({
  apiKey: z.string().min(1, "Weather API key required"),
  defaultLat: z.number().optional(),
  defaultLon: z.number().optional(),
  defaultCity: z.string().optional(),
});

export type WeatherConfig = z.infer<typeof weatherSchema>;
export interface WeatherConfigLegacy {
  apiKey: string;
  defaultLat?: number;
  defaultLon?: number;
  defaultCity?: string;
}

export async function testWeather(cfg: WeatherConfig): Promise<string> {
  const lat = cfg.defaultLat ?? 48.8566;
  const lon = cfg.defaultLon ?? 2.3522;
  const city = cfg.defaultCity;
  if (city) {
    await weatherCurrent(cfg, { city });
    return `Weather: connection OK — ${city}`;
  }
  await weatherCurrent(cfg, { lat, lon });
  return `Weather: connection OK — ${lat},${lon}`;
}

export async function weatherCurrent(
  cfg: WeatherConfig,
  opts: { lat?: number; lon?: number; city?: string; lang?: string; units?: string } = {},
): Promise<unknown> {
  const { lat, lon, city } = resolveCoords(cfg, opts);
  let url: string;
  if (city) {
    // geocoding -> coords then weather (more reliable than q=)
    const coords = await geocode(cfg, city);
    url = `${OWM_BASE}/weather?lat=${coords.lat}&lon=${coords.lon}&appid=${cfg.apiKey}&units=${opts.units ?? "metric"}&lang=${opts.lang ?? "fr"}`;
  } else {
    url = `${OWM_BASE}/weather?lat=${lat}&lon=${lon}&appid=${cfg.apiKey}&units=${opts.units ?? "metric"}&lang=${opts.lang ?? "fr"}`;
  }
  const res = await fetch(url);
  const data = (await res.json()) as { cod?: number | string; message?: string } & Record<string, unknown>;
  if (!res.ok || data.cod === "404" || data.cod === 404) throw new Error(data.message ?? `Weather failed (${res.status})`);
  if (data.cod && String(data.cod) !== "200") throw new Error(data.message ?? `Weather failed (${res.status})`);
  return data;
}

export async function weatherForecast(
  cfg: WeatherConfig,
  opts: { lat?: number; lon?: number; city?: string; lang?: string; units?: string } = {},
): Promise<unknown> {
  const { lat, lon, city } = resolveCoords(cfg, opts);
  let url: string;
  if (city) {
    const coords = await geocode(cfg, city);
    url = `${OWM_BASE}/forecast?lat=${coords.lat}&lon=${coords.lon}&appid=${cfg.apiKey}&units=${opts.units ?? "metric"}&lang=${opts.lang ?? "fr"}`;
  } else {
    url = `${OWM_BASE}/forecast?lat=${lat}&lon=${lon}&appid=${cfg.apiKey}&units=${opts.units ?? "metric"}&lang=${opts.lang ?? "fr"}`;
  }
  const res = await fetch(url);
  const data = (await res.json()) as { cod?: string; message?: string } & Record<string, unknown>;
  if (!res.ok || data.cod !== "200") throw new Error(data.message ?? `Weather forecast failed (${res.status})`);
  return data;
}

function resolveCoords(
  cfg: WeatherConfig,
  opts: { lat?: number; lon?: number; city?: string },
): { lat?: number; lon?: number; city?: string } {
  if (opts.city) return { city: opts.city };
  if (opts.lat !== undefined && opts.lon !== undefined) return { lat: opts.lat, lon: opts.lon };
  if (cfg.defaultCity) return { city: cfg.defaultCity };
  if (cfg.defaultLat !== undefined && cfg.defaultLon !== undefined) return { lat: cfg.defaultLat, lon: cfg.defaultLon };
  return { city: "Paris" };
}

async function geocode(cfg: WeatherConfig, city: string): Promise<{ lat: number; lon: number }> {
  const url = `${OWM_GEO}/direct?q=${encodeURIComponent(city)}&limit=1&appid=${cfg.apiKey}`;
  const res = await fetch(url);
  const data = (await res.json()) as { lat: number; lon: number }[];
  if (!res.ok) throw new Error(`Geocoding failed (${res.status})`);
  if (!data[0]) throw new Error(`City not found: ${city}`);
  return { lat: data[0].lat, lon: data[0].lon };
}

export const weatherProvider = {
  type: "weather",
  label: "Weather",
  schema: weatherSchema,
  test: testWeather,
  sdk: {
    namespace: "weather",
    methods: {
      current: weatherCurrent as (cfg: WeatherConfig, ...args: unknown[]) => Promise<unknown>,
      forecast: weatherForecast as (cfg: WeatherConfig, ...args: unknown[]) => Promise<unknown>,
    },
  },
  ui: { icon: "CloudSun", descriptionKey: "providerWeatherDescription" },
} satisfies ConnectionProvider<WeatherConfig>;
