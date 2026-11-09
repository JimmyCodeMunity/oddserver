const { chromium } = require('playwright');
const Game = require('../models/Game');
const SyncSettings = require('../models/SyncSettings');

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Parse Betika kickoff string "DD/MM, HH:MM" → JS Date (current year assumed).
 * If the resulting date is in the past by more than 1 hour, bump year by 1.
 */
function parseKickoff(str) {
    if (!str) return null;
    try {
        const clean = str.trim();
        // Expected: "03/10, 18:00"
        const m = clean.match(/^(\d{2})\/(\d{2}),\s*(\d{2}):(\d{2})$/);
        if (!m) return null;
        const [, day, month, hour, minute] = m;
        const year = new Date().getFullYear();
        const d = new Date(Date.UTC(year, parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute)));
        // If the parsed date is more than 2 hours in the past, it's next year
        if (d < new Date(Date.now() - 2 * 60 * 60 * 1000)) {
            d.setUTCFullYear(year + 1);
        }
        return d;
    } catch {
        return null;
    }
}

/**
 * Build a stable game_id from home team, away team, and kick-off date.
 * Lowercased, spaces → underscores, special chars stripped.
 */
function buildGameId(home, away, kickoff) {
    const slug = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const dateStr = kickoff ? kickoff.toISOString().slice(0, 10) : 'unknown';
    return `${slug(home)}_vs_${slug(away)}_${dateStr}`;
}

/**
 * Derive a broad sport_key from the league string.
 * Betika leagues look like "International • UEFA Nations L..."
 * We do a simple keyword check.
 */
function deriveSportKey(league) {
    if (!league) return 'soccer';
    const l = league.toLowerCase();
    if (l.includes('basket') || l.includes('nba')) return 'basketball';
    if (l.includes('tennis')) return 'tennis';
    if (l.includes('rugby')) return 'rugby';
    if (l.includes('cricket')) return 'cricket';
    if (l.includes('hockey')) return 'hockey';
    if (l.includes('volleyball')) return 'volleyball';
    if (l.includes('handball')) return 'handball';
    if (l.includes('american') || l.includes('nfl')) return 'american_football';
    if (l.includes('baseball') || l.includes('mlb')) return 'baseball';
    if (l.includes('mma') || l.includes('boxing')) return 'combat_sports';
    return 'soccer'; // default
}

/**
 * Transform a raw scraped match object into the shape our Game model expects.
 */
function transformMatch(raw) {
    const kickoff = parseKickoff(raw.kickoff);
    if (!kickoff || !raw.home || !raw.away) return null;

    return {
        game_id: buildGameId(raw.home, raw.away, kickoff),
        league: raw.league || '',
        sport_key: deriveSportKey(raw.league),
        commence_time: kickoff,
        home_team: raw.home.trim(),
        away_team: raw.away.trim(),
        odds: {
            home: raw.odds?.home ? parseFloat(raw.odds.home) : null,
            draw: raw.odds?.draw ? parseFloat(raw.odds.draw) : null,
            away: raw.odds?.away ? parseFloat(raw.odds.away) : null,
        },
        gg: {
            yes: raw.gg?.yes ? parseFloat(raw.gg.yes) : null,
            no: raw.gg?.no ? parseFloat(raw.gg.no) : null,
        },
        markets_count: raw.markets || null,
        source: 'betika',
        fetched_at: new Date(),
    };
}

// ── Core scraper ──────────────────────────────────────────────────────────────

/**
 * Launch Playwright, scrape Betika, return raw match array.
 * @param {object} opts
 * @param {string} opts.url         - Betika URL
 * @param {number} opts.scrollSteps - how many scroll iterations
 * @param {boolean} opts.headless   - headless mode
 * @param {function} opts.onLog     - optional callback(msg) for live logging
 */
async function scrapeMatches({ url, scrollSteps = 6, headless = true, onLog = () => { } }) {
    onLog(`[Scraper] Launching browser (headless=${headless})…`);

    const browser = await chromium.launch({
        headless,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-blink-features=AutomationControlled',
        ],
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1366, height: 900 },
        locale: 'en-US',
        timezoneId: 'Africa/Nairobi',
    });
    const page = await context.newPage();

    try {
        onLog(`[Scraper] Navigating to ${url}`);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

        // Wait for match cards — if they don't appear, Betika may be blocking
        try {
            await page.waitForSelector('.prebet-match', { timeout: 30000 });
        } catch {
            const title = await page.title();
            throw new Error(`Match cards not found. Page title: "${title}". Betika may be blocking the scraper.`);
        }

        onLog(`[Scraper] Page loaded, scrolling ${scrollSteps} times…`);
        for (let i = 0; i < scrollSteps; i++) {
            await page.mouse.wheel(0, 2500);
            await page.waitForTimeout(1000);
        }

        const raw = await page.evaluate(() => {
            const cards = Array.from(document.querySelectorAll('.prebet-match'));
            return cards.map((card, index) => {
                const timeEl = card.querySelector('.time');
                let league = null, kickoff = null;

                if (timeEl) {
                    const leagueSpan = timeEl.querySelector('span span');
                    league = leagueSpan ? leagueSpan.textContent.trim() : null;
                    const fullText = timeEl.textContent.trim();
                    const timeMatch = fullText.match(/(\d{2}\/\d{2},\s*\d{2}:\d{2})/);
                    kickoff = timeMatch ? timeMatch[1] : null;
                }

                const teamsEl = card.querySelector('.prebet-match__teams');
                let home = null, away = null;
                if (teamsEl) {
                    const homeEl = teamsEl.querySelector('.prebet-match__teams__home');
                    home = homeEl ? homeEl.textContent.trim() : null;
                    const spans = teamsEl.querySelectorAll('span');
                    if (spans.length >= 2) away = spans[1].textContent.trim();
                }

                const oddValues = Array.from(
                    card.querySelectorAll('.prebet-match__odd__odd-value')
                ).map((el) => el.textContent.trim());

                const marketsEl = card.querySelector('.prebet-match__markets');
                const marketsText = marketsEl ? marketsEl.textContent.trim() : null;
                const markets = marketsText ? parseInt(marketsText.replace(/\D/g, '')) || null : null;

                return {
                    index: index + 1,
                    league,
                    kickoff,
                    home,
                    away,
                    odds: {
                        home: oddValues[0] || null,
                        draw: oddValues[1] || null,
                        away: oddValues[2] || null,
                    },
                    // GG (Both Teams to Score) — Betika shows these as the 4th and 5th odd
                    gg: {
                        yes: oddValues[3] || null,
                        no: oddValues[4] || null,
                    },
                    markets,
                };
            });
        });

        onLog(`[Scraper] Scraped ${raw.length} raw matches`);
        return raw;

    } finally {
        await browser.close();
        onLog('[Scraper] Browser closed');
    }
}

// ── Main exported function ────────────────────────────────────────────────────

/**
 * Full scrape + DB upsert pipeline.
 * Reads settings from MongoDB, scrapes Betika, upserts into Game collection.
 *
 * @param {function} onLog - optional live log callback
 * @returns {object} result summary
 */
async function runScraper(onLog = () => { }) {
    const settings = await SyncSettings.findById('global');
    const url = settings?.scrapeUrl || 'https://www.betika.com/en-ke/';
    const scrollSteps = settings?.scrollSteps ?? 6;
    const headless = settings?.headless ?? true;

    const raw = await scrapeMatches({ url, scrollSteps, headless, onLog });

    // Transform and filter out invalid entries
    const docs = raw.map(transformMatch).filter(Boolean);

    if (!docs.length) {
        onLog('[Scraper] No valid matches to save');
        return { total: 0, upserted: 0, modified: 0 };
    }

    // Upsert — update all fields if game_id exists, insert if not
    const ops = docs.map((doc) => ({
        updateOne: {
            filter: { game_id: doc.game_id },
            update: { $set: doc },
            upsert: true,
        },
    }));

    const result = await Game.bulkWrite(ops);

    const summary = {
        total: docs.length,
        upserted: result.upsertedCount,
        modified: result.modifiedCount,
    };

    onLog(`[Scraper] Done — ${summary.total} games saved (${summary.upserted} new, ${summary.modified} updated)`);
    return summary;
}

module.exports = { runScraper, scrapeMatches, transformMatch, parseKickoff };
