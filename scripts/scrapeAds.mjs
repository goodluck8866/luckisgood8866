import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import OpenAI from 'openai';

const DEFAULT_REGION = 'anywhere';
const DEFAULT_PLATFORM = 'SEARCH';
const DEFAULT_SCROLLS = 16;
const DEFAULT_SCROLL_DELAY_MS = 1200;
const DEFAULT_VISION_MODEL = 'gpt-4.1-mini';

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  const searchUrl = buildSearchUrl(options);

  log(`Launching Chromium (headless=${options.headless})`);
  const browser = await chromium.launch({ headless: options.headless });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  const scrapedAt = new Date().toISOString();

  try {
    log(`Navigating to ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded' });

    await searchForAdvertiser(page, options.advertiser);
    await waitForInitialResults(page);

    const ads = await collectAdImages(page, options.maxScrolls, options.scrollDelayMs);
    log(`Collected ${ads.length} unique creative images.`);

    if (ads.length === 0) {
      log('No creatives detected on the page. Exiting.');
      return;
    }

    const enrichedAds = await enrichAds(ads, options, scrapedAt);
    const payload = {
      advertiser: options.advertiser,
      platform: 'google_ads_transparency',
      scrapedAt,
      ads: enrichedAds,
    };

    if (options.workerApiBase) {
      await sendBatchToWorker(options.workerApiBase, payload, options.workerAuthToken);
    } else {
      console.log(JSON.stringify(payload, null, 2));
      log('Worker endpoint not configured; printed payload to stdout instead.');
    }
  } finally {
    await browser.close();
  }
}

function parseCliArgs(argv) {
  const parsed = {};
  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const trimmed = arg.slice(2);
      if (trimmed.includes('=')) {
        const [key, value] = trimmed.split('=', 2);
        parsed[key] = value;
      } else {
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) {
          parsed[trimmed] = next;
          i += 1;
        } else {
          parsed[trimmed] = true;
        }
      }
    } else {
      positional.push(arg);
    }
  }

  const advertiser = stringOption(parsed, 'advertiser') ?? positional[0] ?? process.env.AD_TRANSPARENCY_ADVERTISER;
  if (!advertiser || advertiser.trim().length === 0) {
    printUsage();
    throw new Error('Missing advertiser name. Provide it via --advertiser or as a positional argument.');
  }

  const today = new Date().toISOString().slice(0, 10);
  const startDate = stringOption(parsed, 'start-date') ?? process.env.AD_TRANSPARENCY_START_DATE ?? today;
  const endDate = stringOption(parsed, 'end-date') ?? process.env.AD_TRANSPARENCY_END_DATE ?? startDate;
  const region = stringOption(parsed, 'region') ?? process.env.AD_TRANSPARENCY_REGION ?? DEFAULT_REGION;
  const platform = stringOption(parsed, 'platform') ?? process.env.AD_TRANSPARENCY_PLATFORM ?? DEFAULT_PLATFORM;
  const maxScrolls = numericOption(parsed, 'max-scrolls', DEFAULT_SCROLLS);
  const scrollDelayMs = numericOption(parsed, 'scroll-delay', DEFAULT_SCROLL_DELAY_MS);
  const workerApiBase = stringOption(parsed, 'worker') ?? process.env.WORKER_API_BASE;
  const workerAuthToken = stringOption(parsed, 'worker-token') ?? process.env.WORKER_API_TOKEN ?? process.env.WORKER_AUTH_TOKEN;
  const skipVision = booleanOption(parsed, 'skip-vision') || process.env.SKIP_VISION === 'true';
  const openAiModel = stringOption(parsed, 'vision-model') ?? process.env.OPENAI_VISION_MODEL ?? DEFAULT_VISION_MODEL;
  const headless = !booleanOption(parsed, 'headful');
  const searchUrl = stringOption(parsed, 'search-url') ?? process.env.AD_TRANSPARENCY_URL;

  return {
    advertiser: advertiser.trim(),
    region: region.trim(),
    platform: platform.trim(),
    startDate: startDate.trim(),
    endDate: endDate.trim(),
    maxScrolls,
    scrollDelayMs,
    workerApiBase,
    workerAuthToken: workerAuthToken?.trim() || undefined,
    skipVision,
    openAiModel: openAiModel.trim(),
    headless,
    searchUrl: searchUrl?.trim() || undefined,
  };
}

function buildSearchUrl(options) {
  if (options.searchUrl) {
    return options.searchUrl;
  }

  const params = new URLSearchParams({
    region: options.region,
    platform: options.platform,
    'start-date': options.startDate,
    'end-date': options.endDate,
  });
  return `https://adstransparency.google.com/?${params.toString()}`;
}

async function searchForAdvertiser(page, advertiser) {
  log(`Searching for advertiser "${advertiser}"`);
  const searchSelectors = [
    'input[aria-label="Search ads"]',
    'input[aria-label="Search by advertiser or keyword"]',
    'input[type="search"]',
    'input',
  ];

  let searchHandle = null;
  for (const selector of searchSelectors) {
    searchHandle = await page.$(selector);
    if (searchHandle) {
      break;
    }
  }

  if (!searchHandle) {
    throw new Error('Unable to locate the search input on the transparency page.');
  }

  await searchHandle.click({ clickCount: 3 });
  await searchHandle.fill('');
  await page.waitForTimeout(200);
  await searchHandle.type(advertiser, { delay: 40 });
  await page.waitForTimeout(600);

  const dropdownOption = page.locator('[role="listbox"] [role="option"]');
  if ((await dropdownOption.count()) > 0) {
    await dropdownOption.first().click();
    await page.waitForTimeout(800);
  } else {
    await page.keyboard.press('Enter');
  }
}

async function waitForInitialResults(page) {
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => undefined);
  await page.waitForFunction(
    () => {
      const main = document.querySelector('main');
      if (!main) {
        return false;
      }
      return main.querySelectorAll('img').length > 0;
    },
    { timeout: 20000 },
  );
}

async function collectAdImages(page, maxScrolls, scrollDelayMs) {
  const seen = new Map();
  let stagnantRounds = 0;

  for (let round = 0; round < maxScrolls; round += 1) {
    const beforeCount = seen.size;
    const chunk = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('img'));
      const entries = [];

      for (const node of nodes) {
        const src = node.getAttribute('src') || node.getAttribute('data-src');
        if (!src || !/^https?:/i.test(src)) {
          continue;
        }
        if (!/googleusercontent|ggpht|gstatic|googleapis|doubleclick/i.test(src)) {
          continue;
        }
        const alt = node.getAttribute('alt') || undefined;
        const container =
          node.closest('article') ||
          node.closest('[role="listitem"]') ||
          node.closest('div[data-testid]') ||
          node.parentElement;

        const textSnippets = [];
        if (container) {
          const textNodes = Array.from(
            container.querySelectorAll(
              "h1, h2, h3, h4, h5, h6, p, span, div[role='text'], [data-text]",
            ),
          );
          for (const element of textNodes) {
            const content = element.textContent?.trim();
            if (content && content.length > 1 && content.length <= 600) {
              textSnippets.push(content);
            }
          }
        }

        entries.push({ imageUrl: src, alt, textSnippets });
      }

      return entries;
    });

    for (const entry of chunk) {
      const existing = seen.get(entry.imageUrl);
      if (existing) {
        if (!existing.alt && entry.alt) {
          existing.alt = entry.alt;
        }
        existing.textSnippets = mergeSnippets(existing.textSnippets, entry.textSnippets);
      } else {
        seen.set(entry.imageUrl, {
          imageUrl: entry.imageUrl,
          alt: entry.alt,
          textSnippets: uniqueSnippets(entry.textSnippets),
        });
      }
    }

    if (seen.size === beforeCount) {
      stagnantRounds += 1;
    } else {
      stagnantRounds = 0;
    }

    if (stagnantRounds >= 3) {
      break;
    }

    const loadMoreButton = page.locator('button:has-text("Load more")');
    if ((await loadMoreButton.count()) > 0) {
      await loadMoreButton.first().click({ trial: false }).catch(() => undefined);
      await page.waitForTimeout(scrollDelayMs);
      continue;
    }

    await page.evaluate(() => {
      window.scrollBy({ top: window.innerHeight * 0.85, behavior: 'smooth' });
    });
    await page.waitForTimeout(scrollDelayMs);
  }

  return Array.from(seen.values());
}

async function enrichAds(ads, options, seenAt) {
  const payloads = [];
  const visionClient = createVisionClient(options.skipVision, options.openAiModel);

  for (let index = 0; index < ads.length; index += 1) {
    const ad = ads[index];
    const adIdentifier = createAdIdentifier(ad.imageUrl, index);
    const metadata = {
      alt: ad.alt,
      textSnippets: ad.textSnippets,
      source: {
        region: options.region,
        platform: options.platform,
        startDate: options.startDate,
        endDate: options.endDate,
      },
    };

    const insights = [];

    if (visionClient) {
      log(`Analyzing creative ${index + 1}/${ads.length} with ${visionClient.model}`);
      const analysis = await analyzeImageWithOpenAi(visionClient.client, visionClient.model, ad.imageUrl);
      if (analysis) {
        insights.push({
          model: `openai:${visionClient.model}`,
          insight: analysis.summary,
          insightType: 'summary',
          rawResponse: analysis.raw,
          createdAt: analysis.createdAt,
        });
      }
    }

    payloads.push({
      adIdentifier,
      imageUrl: ad.imageUrl,
      metadata,
      insights,
      seenAt,
    });
  }

  return payloads;
}

function createVisionClient(skipVision, model) {
  if (skipVision) {
    log('Skipping image analysis (--skip-vision)');
    return null;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    log('OPENAI_API_KEY is not set. Vision analysis will be skipped.');
    return null;
  }

  const client = new OpenAI({ apiKey });
  return { client, model };
}

async function analyzeImageWithOpenAi(client, model, imageUrl) {
  try {
    const prompt =
      'You are reviewing an advertisement from the Google Ads Transparency Center. ' +
      'Provide a concise summary of the visual content and any prominent text. ' +
      'List call-to-action messaging, promotion details, political or geographic references, and visible disclaimers.';

    const response = await client.responses.create({
      model,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: prompt },
            { type: 'input_image', image_url: imageUrl },
          ],
        },
      ],
      max_output_tokens: 400,
      temperature: 0.2,
    });

    const summary = extractResponseText(response);
    if (!summary) {
      return null;
    }

    const createdAt = new Date().toISOString();
    const raw = typeof response.toJSON === 'function' ? response.toJSON() : response;

    return { summary: summary.trim(), raw, createdAt };
  } catch (error) {
    console.warn(`[vision] Failed to analyze ${imageUrl}:`, error);
    return null;
  }
}

function extractResponseText(response) {
  if (!response) {
    return null;
  }

  if (typeof response.output_text === 'string' && response.output_text.trim().length > 0) {
    return response.output_text;
  }

  const segments = Array.isArray(response.output) ? response.output : [];
  for (const segment of segments) {
    const contentPieces = Array.isArray(segment.content) ? segment.content : [];
    for (const piece of contentPieces) {
      if (piece && typeof piece.text === 'string' && piece.text.trim().length > 0) {
        return piece.text;
      }
    }
  }

  return null;
}

async function sendBatchToWorker(apiBase, payload, token) {
  const endpoint = new URL('/api/ads/batch', ensureTrailingSlash(apiBase));
  log(`Uploading ${payload.ads.length} creatives to ${endpoint.toString()}`);

  const headers = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(endpoint.toString(), {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Worker responded with ${response.status}: ${text}`);
  }

  const result = await response.json().catch(() => undefined);
  log(`Worker stored ${(result === null || result === void 0 ? void 0 : result.processedAds) ?? payload.ads.length} creatives successfully.`);
}

function createAdIdentifier(imageUrl, index) {
  const hash = createHash('sha1').update(imageUrl).digest('hex');
  return `${hash}-${index + 1}`;
}

function mergeSnippets(existing, incoming) {
  const merged = existing.slice(0, 20);
  const seen = new Set(merged);
  for (const snippet of incoming) {
    if (!seen.has(snippet)) {
      merged.push(snippet);
      seen.add(snippet);
    }
    if (merged.length >= 20) {
      break;
    }
  }
  return merged;
}

function uniqueSnippets(snippets) {
  return Array.from(new Set(snippets)).slice(0, 20);
}

function ensureTrailingSlash(url) {
  return url.endsWith('/') ? url : `${url}/`;
}

function stringOption(parsed, key) {
  const value = parsed[key];
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }
  return undefined;
}

function numericOption(parsed, key, fallback) {
  const value = parsed[key];
  if (typeof value === 'string') {
    const parsedNumber = Number.parseInt(value, 10);
    if (!Number.isNaN(parsedNumber)) {
      return parsedNumber;
    }
  }
  return fallback;
}

function booleanOption(parsed, key) {
  const value = parsed[key];
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return value === 'true' || value === '1';
  }
  return false;
}

function printUsage() {
  console.log(`Usage: npm run scrape -- --advertiser "名称" [options]

Options:
  --start-date YYYY-MM-DD    Set the start date for the transparency query (default: today)
  --end-date YYYY-MM-DD      Set the end date (default: start date)
  --region REGION            Geographic region (default: anywhere)
  --platform PLATFORM        Ad platform (default: SEARCH)
  --max-scrolls N            Maximum scroll iterations while collecting creatives (default: ${DEFAULT_SCROLLS})
  --scroll-delay MS          Delay between scroll iterations in milliseconds (default: ${DEFAULT_SCROLL_DELAY_MS})
  --worker URL               Cloudflare Worker base URL to store results
  --worker-token TOKEN       Bearer token to send in the Authorization header
  --skip-vision              Skip image analysis with OpenAI Vision
  --vision-model MODEL       Vision model identifier (default: ${DEFAULT_VISION_MODEL})
  --headful                  Launch Chromium with a visible window for debugging
`);
}

function log(message) {
  console.log(`[scraper] ${message}`);
}

main().catch((error) => {
  console.error('[scraper] Unexpected failure:', error);
  process.exit(1);
});
