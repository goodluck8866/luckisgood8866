import { renderHtml, type RenderableAd } from "./renderHtml";

type BatchInsight = {
  model: string;
  insight: string;
  insightType?: string;
  rawResponse?: unknown;
  createdAt?: string;
};

type BatchAd = {
  adIdentifier: string;
  imageUrl: string;
  metadata?: Record<string, unknown>;
  insights: BatchInsight[];
  seenAt?: string;
};

type BatchPayload = {
  advertiser: string;
  platform?: string;
  scrapedAt?: string;
  ads: BatchAd[];
};

type StoredInsight = {
  id: number;
  model: string;
  insightType: string;
  insight: string;
  rawResponse: unknown | null;
  createdAt: string;
  updatedAt: string;
};

type StoredAd = {
  id: number;
  advertiserName: string;
  platform: string;
  adIdentifier: string;
  imageUrl: string;
  metadata: Record<string, unknown> | null;
  firstSeen: string;
  lastSeen: string;
  insights: StoredInsight[];
};

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
};

class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    try {
      if (request.method === "GET" && url.pathname === "/") {
        const advertiser = optionalString(url.searchParams.get("advertiser"));
        const limit = clampLimit(url.searchParams.get("limit"));
        const ads = await fetchAds(env, { advertiser, limit });
        return new Response(renderHtml({ advertiser, ads }), {
          headers: {
            "content-type": "text/html; charset=utf-8",
          },
        });
      }

      if (request.method === "GET" && url.pathname === "/api/ads") {
        const advertiser = optionalString(url.searchParams.get("advertiser"));
        const limit = clampLimit(url.searchParams.get("limit"));
        const ads = await fetchAds(env, { advertiser, limit });
        return Response.json(
          {
            advertiser: advertiser ?? null,
            count: ads.length,
            ads,
          },
          { headers: JSON_HEADERS },
        );
      }

      if (request.method === "POST" && url.pathname === "/api/ads/batch") {
        const body = await request.json().catch(() => {
          throw new HttpError(400, "Request body must be valid JSON.");
        });
        const payload = parseBatchPayload(body);
        const result = await storeAdsBatch(env, payload);
        return Response.json(result, { status: 201, headers: JSON_HEADERS });
      }
    } catch (error) {
      if (error instanceof HttpError) {
        return Response.json(
          {
            error: error.message,
            details: error.details ?? null,
          },
          { status: error.status, headers: JSON_HEADERS },
        );
      }

      console.error("Unexpected error", error);
      return new Response("Internal Server Error", { status: 500 });
    }

    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

function optionalString(value: string | null): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function clampLimit(value: string | null): number {
  if (!value) {
    return 20;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return 20;
  }

  return Math.max(1, Math.min(100, parsed));
}

function parseBatchPayload(body: unknown): BatchPayload {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Request body must be an object.");
  }

  const raw = body as Record<string, unknown>;
  const advertiser = ensureNonEmptyString(raw.advertiser, "advertiser");
  const platformValue = typeof raw.platform === "string" ? raw.platform : null;
  const platform = optionalString(platformValue) ?? "google_ads_transparency";

  const scrapedAt = parseOptionalIsoDate(raw.scrapedAt, "scrapedAt");

  if (!Array.isArray(raw.ads) || raw.ads.length === 0) {
    throw new HttpError(400, "Field ads must be a non-empty array.");
  }

  const ads = raw.ads.map((value, index) => parseAdPayload(value, index));

  return {
    advertiser,
    platform,
    scrapedAt,
    ads,
  };
}

function parseAdPayload(value: unknown, index: number): BatchAd {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "Ad entry at index " + index + " must be an object.");
  }

  const raw = value as Record<string, unknown>;
  const adIdentifier = ensureNonEmptyString(raw.adIdentifier, "ads[" + index + "].adIdentifier");
  const imageUrl = ensureNonEmptyString(raw.imageUrl, "ads[" + index + "].imageUrl");

  let metadata: Record<string, unknown> | undefined;
  if (raw.metadata !== undefined) {
    if (!isPlainObject(raw.metadata)) {
      throw new HttpError(400, "ads[" + index + "].metadata must be an object when provided.");
    }
    metadata = raw.metadata as Record<string, unknown>;
  }

  const seenAt = parseOptionalIsoDate(raw.seenAt, "ads[" + index + "].seenAt");

  const insightsRaw = raw.insights;
  let insights: BatchInsight[] = [];
  if (insightsRaw !== undefined) {
    if (!Array.isArray(insightsRaw)) {
      throw new HttpError(400, "ads[" + index + "].insights must be an array when provided.");
    }

    insights = insightsRaw.map((entry, insightIndex) => parseInsight(entry, index, insightIndex));
  }

  return {
    adIdentifier,
    imageUrl,
    metadata,
    insights,
    seenAt,
  };
}

function parseInsight(value: unknown, adIndex: number, insightIndex: number): BatchInsight {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "ads[" + adIndex + "].insights[" + insightIndex + "] must be an object.");
  }

  const raw = value as Record<string, unknown>;

  const model = ensureNonEmptyString(raw.model, "ads[" + adIndex + "].insights[" + insightIndex + "].model");
  const insight = ensureNonEmptyString(raw.insight, "ads[" + adIndex + "].insights[" + insightIndex + "].insight");
  const insightTypeValue = typeof raw.insightType === "string" ? raw.insightType : null;
  const insightType = optionalString(insightTypeValue) ?? "summary";
  const createdAt = parseOptionalIsoDate(raw.createdAt, "ads[" + adIndex + "].insights[" + insightIndex + "].createdAt");

  return {
    model,
    insight,
    insightType,
    rawResponse: raw.rawResponse,
    createdAt,
  };
}

function ensureNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new HttpError(400, "Field " + field + " must be a string.");
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new HttpError(400, "Field " + field + " cannot be empty.");
  }

  return trimmed;
}

function parseOptionalIsoDate(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new HttpError(400, "Field " + field + " must be a string when provided.");
  }

  if (!isValidIsoDate(value)) {
    throw new HttpError(400, "Field " + field + " must be an ISO 8601 timestamp.");
  }

  return value;
}

function isValidIsoDate(value: string): boolean {
  if (!value.trim()) {
    return false;
  }

  const date = new Date(value);
  return Number.isFinite(date.getTime());
}

function isPlainObject(value: unknown): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function storeAdsBatch(env: Env, payload: BatchPayload) {
  const platform = payload.platform ?? "google_ads_transparency";
  const defaultTimestamp = payload.scrapedAt ?? new Date().toISOString();
  const stored: { adId: number; adIdentifier: string }[] = [];

  const insertAdSql = [
    "INSERT INTO ads (advertiser_name, platform, ad_identifier, image_url, metadata, first_seen, last_seen)",
    "VALUES (?, ?, ?, ?, ?, ?, ?)",
    "ON CONFLICT(advertiser_name, platform, ad_identifier)",
    "DO UPDATE SET",
    "  image_url=excluded.image_url,",
    "  metadata=COALESCE(excluded.metadata, ads.metadata),",
    "  last_seen=excluded.last_seen",
  ].join(" ");

  const upsertInsightSql = [
    "INSERT INTO ad_insights (ad_id, model, insight_type, insight, raw_response, created_at, updated_at)",
    "VALUES (?, ?, ?, ?, ?, ?, ?)",
    "ON CONFLICT(ad_id, model, insight_type)",
    "DO UPDATE SET",
    "  insight=excluded.insight,",
    "  raw_response=excluded.raw_response,",
    "  updated_at=excluded.updated_at",
  ].join(" ");

  for (const ad of payload.ads) {
    const seenAt = ad.seenAt ?? defaultTimestamp;
    const metadataJson = ad.metadata ? safeStringify(ad.metadata) : null;

    await env.DB.prepare(insertAdSql)
      .bind(payload.advertiser, platform, ad.adIdentifier, ad.imageUrl, metadataJson, seenAt, seenAt)
      .run();

    const adRow = await env.DB.prepare(
      "SELECT id FROM ads WHERE advertiser_name = ? AND platform = ? AND ad_identifier = ?"
    )
      .bind(payload.advertiser, platform, ad.adIdentifier)
      .first<{ id: number }>();

    if (!adRow) {
      throw new HttpError(500, "Failed to look up stored ad record.");
    }

    const adId = adRow.id;
    stored.push({ adId, adIdentifier: ad.adIdentifier });

    if (ad.insights.length > 0) {
      for (const insight of ad.insights) {
        const createdAt = insight.createdAt ?? seenAt;
        const raw = insight.rawResponse !== undefined ? safeStringify(insight.rawResponse) : null;

        await env.DB.prepare(upsertInsightSql)
          .bind(adId, insight.model, insight.insightType ?? "summary", insight.insight, raw, createdAt, seenAt)
          .run();
      }
    }
  }

  return {
    advertiser: payload.advertiser,
    platform,
    processedAds: stored.length,
  };
}

async function fetchAds(env: Env, options: { advertiser?: string; limit: number }): Promise<RenderableAd[]> {
  const baseQuery = "SELECT id, advertiser_name, platform, ad_identifier, image_url, metadata, first_seen, last_seen FROM ads";

  let stmt: D1PreparedStatement;
  if (options.advertiser) {
    const query = baseQuery + " WHERE advertiser_name = ? ORDER BY last_seen DESC LIMIT ?";
    stmt = env.DB.prepare(query).bind(options.advertiser, options.limit);
  } else {
    const query = baseQuery + " ORDER BY last_seen DESC LIMIT ?";
    stmt = env.DB.prepare(query).bind(options.limit);
  }

  const adResult = await stmt.all<{
    id: number;
    advertiser_name: string;
    platform: string;
    ad_identifier: string;
    image_url: string;
    metadata: string | null;
    first_seen: string;
    last_seen: string;
  }>();

  const adRows = adResult.results ?? [];
  if (adRows.length === 0) {
    return [];
  }

  const ads: Map<number, StoredAd> = new Map();
  for (const row of adRows) {
    ads.set(row.id, {
      id: row.id,
      advertiserName: row.advertiser_name,
      platform: row.platform,
      adIdentifier: row.ad_identifier,
      imageUrl: row.image_url,
      metadata: parseJson<Record<string, unknown>>(row.metadata),
      firstSeen: row.first_seen,
      lastSeen: row.last_seen,
      insights: [],
    });
  }

  const adIds = adRows.map((row) => row.id);
  const placeholders = adIds.map(() => "?").join(", ");
  const insightQuery =
    "SELECT id, ad_id, model, insight_type, insight, raw_response, created_at, updated_at FROM ad_insights WHERE ad_id IN (" +
    placeholders +
    ") ORDER BY updated_at DESC";

  const insightStmt = env.DB.prepare(insightQuery).bind(...adIds);
  const insightResult = await insightStmt.all<{
    id: number;
    ad_id: number;
    model: string;
    insight_type: string;
    insight: string;
    raw_response: string | null;
    created_at: string;
    updated_at: string;
  }>();

  for (const row of insightResult.results ?? []) {
    const ad = ads.get(row.ad_id);
    if (!ad) {
      continue;
    }

    const rawResponse = parseJson<unknown>(row.raw_response);

    ad.insights.push({
      id: row.id,
      model: row.model,
      insightType: row.insight_type,
      insight: row.insight,
      rawResponse,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }

  return Array.from(ads.values());
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch (error) {
    console.warn("Failed to stringify value for storage", error);
    throw new HttpError(400, "Unable to serialize provided JSON value.");
  }
}

function parseJson<T>(value: string | null): T | null {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as T;
  } catch (error) {
    console.warn("Failed to parse stored JSON", error);
    return null;
  }
}
