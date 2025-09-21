# Google Ads Transparency Collector (Worker + D1)

This project turns the stock Cloudflare D1 template into a small data service for
capturing creatives from the [Google Ads Transparency Center](https://adstransparency.google.com/).
It consists of two parts:

- **Cloudflare Worker + D1 database** – stores ad images and AI-generated insights,
  exposes a REST API, and renders a small dashboard at `/`.
- **Playwright-based scraper CLI** – opens the transparency site for a specific
  advertiser, extracts all creative image URLs, optionally runs OpenAI Vision to
  describe the content, and pushes the data into the Worker.

## Features

- `POST /api/ads/batch` upserts creatives and insights into Cloudflare D1.
- `GET /api/ads` returns stored creatives as JSON, filterable by advertiser.
- `/` renders a quick dashboard showing the latest creatives, metadata and
  recognised text or model summaries.
- `npm run scrape` automates the Google Ads Transparency flow (search → advertiser
  detail page → scroll → collect images) and can optionally call OpenAI Vision to
  describe each creative.

## Prerequisites

- Node.js 18 or newer.
- A Cloudflare account with the D1 beta enabled.
- (Optional) An OpenAI API key if you want the CLI to generate image summaries.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. If you intend to run the scraper, install a local Chromium build for Playwright:
   ```bash
   npx playwright install chromium
   ```
3. Create (or update) a D1 database in `wrangler.json`, then apply the migrations:
   ```bash
   # Local development database
   npx wrangler d1 migrations apply DB --local

   # Remote database (when you are ready to deploy)
   npx wrangler d1 migrations apply DB --remote
   ```
4. Run the Worker locally with Wrangler:
   ```bash
   npm run dev
   ```
   The dashboard will be available at http://127.0.0.1:8787/.

## API overview

### `GET /api/ads`

Returns the latest creatives stored in D1.

Query parameters:

| Parameter    | Description                                      |
|--------------|--------------------------------------------------|
| `advertiser` | Optional filter by advertiser name.              |
| `limit`      | Number of creatives to return (default 20, max 100). |

Example response (truncated):

```json
{
  "advertiser": "吴中区长桥蛮红阁包子店",
  "count": 2,
  "ads": [
    {
      "id": 1,
      "advertiserName": "吴中区长桥蛮红阁包子店",
      "adIdentifier": "4f86…-1",
      "imageUrl": "https://lh3.googleusercontent.com/...",
      "metadata": {
        "alt": "广告素材",
        "textSnippets": ["匠心小笼包", "门店地址"]
      },
      "firstSeen": "2025-08-15T02:15:23.000Z",
      "lastSeen": "2025-08-15T02:15:23.000Z",
      "insights": [
        {
          "model": "openai:gpt-4.1-mini",
          "insightType": "summary",
          "insight": "广告展示蒸汽腾腾的小笼包，并强调门店地址和电话…",
          "updatedAt": "2025-08-15T02:16:10.000Z"
        }
      ]
    }
  ]
}
```

### `POST /api/ads/batch`

Stores a batch of creatives and optional model insights. Existing records are
updated based on the tuple `(advertiser, platform, adIdentifier)`.

Request body:

```json
{
  "advertiser": "吴中区长桥蛮红阁包子店",
  "platform": "google_ads_transparency",
  "scrapedAt": "2025-08-15T02:15:23.000Z",
  "ads": [
    {
      "adIdentifier": "4f86...-1",
      "imageUrl": "https://lh3.googleusercontent.com/...",
      "seenAt": "2025-08-15T02:15:23.000Z",
      "metadata": {
        "alt": "广告素材",
        "textSnippets": ["匠心小笼包", "门店地址"]
      },
      "insights": [
        {
          "model": "openai:gpt-4.1-mini",
          "insightType": "summary",
          "insight": "广告展示蒸汽腾腾的小笼包，并强调门店地址和电话。",
          "rawResponse": { "tokens": 225 }
        }
      ]
    }
  ]
}
```

On success the Worker responds with:

```json
{
  "advertiser": "吴中区长桥蛮红阁包子店",
  "platform": "google_ads_transparency",
  "processedAds": 1
}
```

## Scraper CLI (`npm run scrape`)

The `scripts/scrapeAds.ts` helper automates the workflow described in the user
request. Example usage:

```bash
# Scrape creatives for the advertiser and push them into a local dev worker
WORKER_API_BASE="http://127.0.0.1:8787" npm run scrape -- --advertiser "吴中区长桥蛮红阁包子店" --start-date 2025-08-15 --end-date 2025-08-15
```

Notable options:

| Flag | Description |
|------|-------------|
| `--region` / `--platform` | Override the transparency filters (defaults: `anywhere`, `SEARCH`). |
| `--max-scrolls` / `--scroll-delay` | Tune how aggressively the page is scrolled to load more creatives. |
| `--worker` | Base URL of the Worker API. If omitted the script prints the payload to stdout. |
| `--worker-token` | Optional bearer token added as `Authorization: Bearer …` when calling the Worker. |
| `--skip-vision` | Disable OpenAI image analysis. |
| `--vision-model` | Choose a different OpenAI Responses model (default `gpt-4.1-mini`). |
| `--headful` | Launch Chromium with a visible window for debugging. |

Environment variables can also be used (`WORKER_API_BASE`, `WORKER_API_TOKEN`,
`OPENAI_API_KEY`, etc.). When `OPENAI_API_KEY` is present the script will call
OpenAI's Responses API to generate a textual summary of each creative; if the key
is missing or `--skip-vision` is set, the vision step is skipped automatically.

## Dashboard

Visiting `/` renders the latest creatives using the data in D1. Each card shows:

- creative image (click to open the original URL),
- identifier, first/last seen timestamps, platform,
- captured metadata such as recognised text snippets,
- model insights with expandable raw JSON payloads.

## Development tips

- The migrations folder now contains `0002_create_ads_tables.sql`, which drops
  the original demo `comments` table and creates the new `ads` and `ad_insights`
  tables.
- When developing locally you can inspect the database with
  `npx wrangler d1 execute DB --local --command "SELECT * FROM ads"`.
- The scraper uses Playwright; if you run it in a CI environment make sure the
  necessary browser binaries are installed (`npx playwright install`).
- Be respectful of the target site's terms of service. The script includes
  conservative scroll delays, but you may still want to adjust them or add
  throttling depending on your deployment environment.
