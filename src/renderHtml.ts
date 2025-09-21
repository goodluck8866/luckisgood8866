export type RenderableInsight = {
  id: number;
  model: string;
  insightType: string;
  insight: string;
  rawResponse: unknown | null;
  createdAt: string;
  updatedAt: string;
};

export type RenderableAd = {
  id: number;
  advertiserName: string;
  platform: string;
  adIdentifier: string;
  imageUrl: string;
  metadata: Record<string, unknown> | null;
  firstSeen: string;
  lastSeen: string;
  insights: RenderableInsight[];
};

interface RenderHtmlInput {
  advertiser?: string;
  ads: RenderableAd[];
}

export function renderHtml({ advertiser, ads }: RenderHtmlInput): string {
  const heading = advertiser
    ? `Ads for ${escapeHtml(advertiser)}`
    : "Stored advertiser creatives";
  const filterHint =
    advertiser !== undefined
      ? `Showing results filtered by "${escapeHtml(advertiser)}".`
      : "Showing the most recent creatives that were ingested.";
  const cards = ads.length > 0 ? ads.map(renderAdCard).join("") : emptyStateHtml();

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${heading}</title>
    <style>
      :root {
        color-scheme: light dark;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        font-family: "Inter", "Segoe UI", system-ui, -apple-system, sans-serif;
        background-color: #f1f5f9;
        color: #0f172a;
      }

      header {
        background: linear-gradient(135deg, #0f172a, #2563eb);
        color: #f8fafc;
        padding: 2.5rem 1.5rem 2rem 1.5rem;
        text-align: center;
      }

      header h1 {
        margin: 0 0 0.75rem 0;
        font-size: clamp(1.8rem, 2.4vw, 2.6rem);
      }

      header p {
        margin: 0;
        color: rgba(248, 250, 252, 0.85);
        font-size: 1rem;
      }

      main {
        max-width: 1100px;
        margin: 0 auto;
        padding: 2rem 1.5rem 3rem 1.5rem;
      }

      .intro {
        background-color: #fff;
        border-radius: 0.75rem;
        padding: 1.25rem 1.5rem;
        margin-bottom: 2rem;
        box-shadow: 0 12px 35px -20px rgba(15, 23, 42, 0.45);
      }

      .intro p {
        margin: 0;
        color: #475569;
        line-height: 1.6;
      }

      .intro code {
        background-color: rgba(37, 99, 235, 0.08);
        padding: 0.2rem 0.4rem;
        border-radius: 0.4rem;
        font-size: 0.9rem;
      }

      .empty-state {
        background: #fff;
        border-radius: 0.75rem;
        padding: 2rem;
        text-align: center;
        color: #475569;
        line-height: 1.6;
        box-shadow: 0 20px 40px -24px rgba(15, 23, 42, 0.3);
      }

      .ad-card {
        background: #fff;
        border-radius: 1rem;
        padding: 1.75rem;
        margin-bottom: 2rem;
        box-shadow: 0 24px 40px -28px rgba(15, 23, 42, 0.32);
      }

      .ad-grid {
        display: grid;
        gap: 1.5rem;
        grid-template-columns: minmax(0, 1fr);
      }

      @media (min-width: 900px) {
        .ad-grid {
          grid-template-columns: 320px minmax(0, 1fr);
        }
      }

      .ad-image {
        background: #eef2ff;
        border-radius: 0.8rem;
        padding: 0.5rem;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .ad-image img {
        max-width: 100%;
        border-radius: 0.65rem;
        box-shadow: 0 15px 30px -22px rgba(15, 23, 42, 0.45);
      }

      .ad-content h2 {
        margin: 0;
        font-size: 1.35rem;
        color: #1e293b;
      }

      .ad-meta {
        margin: 0.75rem 0 1.25rem 0;
        font-size: 0.9rem;
        color: #475569;
        line-height: 1.5;
      }

      .ad-meta strong {
        color: #0f172a;
      }

      .metadata,
      .insights {
        margin-top: 1.5rem;
      }

      .metadata p {
        margin: 0 0 0.8rem 0;
      }

      .metadata ul {
        margin: 0.5rem 0 0 1.25rem;
      }

      .metadata details,
      .insight details {
        margin-top: 1rem;
        background: rgba(148, 163, 184, 0.12);
        border-radius: 0.6rem;
        padding: 0.75rem 1rem;
      }

      .metadata details summary,
      .insight details summary {
        cursor: pointer;
        font-weight: 600;
        color: #1d4ed8;
      }

      .metadata pre,
      .insight pre {
        overflow-x: auto;
        font-family: "JetBrains Mono", "Fira Code", monospace;
        font-size: 0.85rem;
        line-height: 1.5;
        margin-top: 0.75rem;
        white-space: pre-wrap;
        word-break: break-word;
      }

      .snippets-title {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        font-weight: 600;
        color: #0f172a;
      }

      .snippets-title span {
        display: inline-block;
        background: rgba(37, 99, 235, 0.12);
        color: #1d4ed8;
        padding: 0.1rem 0.5rem;
        border-radius: 9999px;
        font-size: 0.75rem;
        letter-spacing: 0.02em;
      }

      .insights-list {
        list-style: none;
        padding: 0;
        margin: 0;
        display: grid;
        gap: 1.25rem;
      }

      .insight {
        border: 1px solid rgba(148, 163, 184, 0.35);
        border-radius: 0.9rem;
        padding: 1.2rem 1.35rem;
        background: rgba(248, 250, 252, 0.85);
      }

      .insight-header {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5rem 1rem;
        align-items: baseline;
        margin-bottom: 0.85rem;
      }

      .insight-header .model {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        background: rgba(37, 99, 235, 0.12);
        color: #1d4ed8;
        padding: 0.2rem 0.6rem;
        border-radius: 9999px;
        font-size: 0.8rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }

      .insight-header .type {
        font-size: 0.8rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: #475569;
      }

      .insight-header .timestamp {
        font-size: 0.8rem;
        color: #64748b;
      }

      .insight-body {
        margin: 0;
        font-size: 0.98rem;
        line-height: 1.6;
        color: #0f172a;
      }

      .insights-empty {
        margin: 0;
        font-size: 0.95rem;
        color: #64748b;
      }

      a.image-link {
        color: inherit;
        text-decoration: none;
      }

      footer {
        margin-top: 3rem;
        text-align: center;
        color: #94a3b8;
        font-size: 0.85rem;
      }
    </style>
  </head>
  <body>
    <header>
      <h1>${heading}</h1>
      <p>${filterHint}</p>
    </header>
    <main>
      <section class="intro">
        <p>
          Use <code>GET /api/ads?advertiser=名称</code> to fetch structured JSON or
          <code>POST /api/ads/batch</code> to ingest new creatives scraped from the
          Google Ads Transparency Center.
        </p>
      </section>
      ${cards}
      <footer>
        Worker-backed storage powered by Cloudflare D1 · ${new Date().getFullYear()}
      </footer>
    </main>
  </body>
</html>`;
}

function emptyStateHtml(): string {
  return `
    <div class="empty-state">
      <h2>No creatives stored yet</h2>
      <p>
        Run the scraping script or call the <code>/api/ads/batch</code> endpoint to
        populate this dashboard. Once data is stored, the most recent creatives and
        their AI-generated insights will appear here.
      </p>
    </div>
  `;
}

function renderAdCard(ad: RenderableAd): string {
  const metadataSection = renderMetadata(ad.metadata);
  const insightsSection = renderInsights(ad.insights);

  return `
    <article class="ad-card">
      <div class="ad-grid">
        <div class="ad-image">
          <a class="image-link" href="${escapeHtml(ad.imageUrl)}" target="_blank" rel="noopener noreferrer">
            <img src="${escapeHtml(ad.imageUrl)}" alt="Ad creative" loading="lazy" />
          </a>
        </div>
        <div class="ad-content">
          <h2>${escapeHtml(ad.advertiserName)}</h2>
          <p class="ad-meta">
            <strong>Identifier:</strong> ${escapeHtml(ad.adIdentifier)}<br />
            <strong>Platform:</strong> ${escapeHtml(ad.platform)}<br />
            <strong>First seen:</strong> ${formatTimestamp(ad.firstSeen)}<br />
            <strong>Last seen:</strong> ${formatTimestamp(ad.lastSeen)}
          </p>
          ${metadataSection}
          ${insightsSection}
        </div>
      </div>
    </article>
  `;
}

function renderMetadata(metadata: Record<string, unknown> | null): string {
  if (!metadata) {
    return '<div class="metadata"><p>No additional metadata captured.</p></div>';
  }

  const rawSnippetValues = Array.isArray((metadata as { textSnippets?: unknown[] }).textSnippets)
    ? ((metadata as { textSnippets?: unknown[] }).textSnippets ?? [])
    : [];
  const textSnippets = rawSnippetValues
    .map((value) => (typeof value === "string" ? value.trim() : undefined))
    .filter((value): value is string => typeof value === "string" && value.length > 0);
  const alt = typeof (metadata as { alt?: unknown }).alt === "string" ? (metadata as { alt?: string }).alt : undefined;

  let html = '<div class="metadata">';
  if (alt && alt.trim().length > 0) {
    html += `<p><strong>Image alt text:</strong> ${escapeHtml(alt.trim())}</p>`;
  }

  if (textSnippets.length > 0) {
    html += '<div class="snippets">';
    html += '<span class="snippets-title">Recognised text<span>OCR</span></span>';
    html += '<ul>' + textSnippets.map((snippet) => `<li>${escapeHtml(snippet)}</li>`).join("") + '</ul>';
    html += '</div>';
  }

  html += `
    <details>
      <summary>Metadata JSON</summary>
      <pre>${escapeHtml(JSON.stringify(metadata, null, 2))}</pre>
    </details>
  `;
  html += '</div>';

  return html;
}

function renderInsights(insights: RenderableInsight[]): string {
  if (insights.length === 0) {
    return '<p class="insights-empty">No model insights stored yet.</p>';
  }

  const items = insights.map(renderInsight).join("");
  return `<ul class="insights-list">${items}</ul>`;
}

function renderInsight(insight: RenderableInsight): string {
  const header = `
    <div class="insight-header">
      <span class="model">${escapeHtml(insight.model)}</span>
      <span class="type">${escapeHtml(insight.insightType)}</span>
      <span class="timestamp" title="Generated ${escapeHtml(insight.createdAt)}">
        Updated ${formatTimestamp(insight.updatedAt)}
      </span>
    </div>
  `;
  const body = `<p class="insight-body">${formatMultiline(insight.insight)}</p>`;
  const raw =
    insight.rawResponse !== null && insight.rawResponse !== undefined
      ? `
          <details>
            <summary>Raw response</summary>
            <pre>${escapeHtml(JSON.stringify(insight.rawResponse, null, 2))}</pre>
          </details>
        `
      : "";

  return `<li class="insight">${header}${body}${raw}</li>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return escapeHtml(value);
  }

  const formatted = date.toLocaleString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  return formatted.replace(",", "").replace(/ /g, " ") + " UTC";
}

function formatMultiline(value: string): string {
  return escapeHtml(value).replace(/\n/g, "<br />");
}
