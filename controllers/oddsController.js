const Game = require('../models/Game');
const SyncSettings = require('../models/SyncSettings');
const { runScraper } = require('../services/scraperService');

// ── Sync (cron + public manual trigger) ──────────────────────────────────────

/**
 * Run the Betika scraper and upsert into DB.
 * Called by cron (req=null, res=null) or by POST /api/odds/sync.
 */
const syncOdds = async (req, res) => {
    const logs = [];
    const onLog = (msg) => { console.log(msg); logs.push(msg); };

    try {
        const summary = await runScraper(onLog);

        if (res) {
            return res.status(200).json({
                message: 'Scrape successful',
                ...summary,
                log: logs,
            });
        }
    } catch (err) {
        console.error('[Sync Error]', err.message);
        if (res) return res.status(500).json({ error: err.message, log: logs });
    }
};

// ── Admin force-scrape ────────────────────────────────────────────────────────

/**
 * POST /api/admin/force-scrape
 * Re-runs the full scraper immediately, using current DB settings.
 * Returns a live log so the admin UI can show progress.
 */
const forceScrape = async (req, res) => {
    const logs = [];
    const onLog = (msg) => { console.log(msg); logs.push(msg); };

    try {
        const summary = await runScraper(onLog);
        return res.status(200).json({
            message: 'Force scrape complete',
            ...summary,
            log: logs,
        });
    } catch (err) {
        console.error('[ForceScrape Error]', err.message);
        return res.status(500).json({ error: err.message, log: logs });
    }
};

// ── Public read endpoints ─────────────────────────────────────────────────────

/**
 * GET /api/odds
 * Filters: ?sport= &date= &team= &league= &page= &limit=
 */
const getOdds = async (req, res) => {
    try {
        const { sport, date, team, league, page = 1, limit = 20 } = req.query;

        const settings = await SyncSettings.findById('global');
        const hiddenGames = settings?.hiddenGames || [];
        const featuredGames = settings?.featuredGames || [];

        const filter = {};

        if (sport) filter.sport_key = sport;
        if (league) filter.league = new RegExp(league, 'i');

        if (date) {
            const start = new Date(date); start.setUTCHours(0, 0, 0, 0);
            const end = new Date(date); end.setUTCHours(23, 59, 59, 999);
            filter.commence_time = { $gte: start, $lte: end };
        } else {
            filter.commence_time = { $gte: new Date() };
        }

        if (team) {
            const regex = new RegExp(team, 'i');
            filter.$or = [{ home_team: regex }, { away_team: regex }];
        }

        if (hiddenGames.length) filter.game_id = { $nin: hiddenGames };

        // Always exclude stale documents that have no Betika odds
        filter['odds.home'] = { $ne: null };
        filter.source = 'betika';

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const total = await Game.countDocuments(filter);
        let games = await Game.find(filter)
            .sort({ commence_time: 1 })
            .skip(skip)
            .limit(parseInt(limit))
            .lean();

        const featuredSet = new Set(featuredGames);
        games = games.map((g) => ({ ...g, isFeatured: featuredSet.has(g.game_id) }));

        return res.status(200).json({
            total,
            page: parseInt(page),
            limit: parseInt(limit),
            pages: Math.ceil(total / parseInt(limit)),
            games,
        });
    } catch (err) {
        console.error('[getOdds Error]', err.message);
        return res.status(500).json({ error: err.message });
    }
};

/**
 * GET /api/odds/sports
 * Returns distinct sport keys present in upcoming games.
 */
const getSports = async (req, res) => {
    try {
        const settings = await SyncSettings.findById('global');
        const hiddenGames = settings?.hiddenGames || [];

        const filter = { commence_time: { $gte: new Date() }, 'odds.home': { $ne: null }, source: 'betika' };
        if (hiddenGames.length) filter.game_id = { $nin: hiddenGames };

        const sports = await Game.distinct('sport_key', filter);
        return res.status(200).json({ sports });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};

/**
 * GET /api/odds/leagues
 * Returns distinct leagues present in upcoming games (for the filter bar).
 */
const getLeagues = async (req, res) => {
    try {
        const settings = await SyncSettings.findById('global');
        const hiddenGames = settings?.hiddenGames || [];

        const filter = { commence_time: { $gte: new Date() }, 'odds.home': { $ne: null }, source: 'betika' };
        if (hiddenGames.length) filter.game_id = { $nin: hiddenGames };

        const leagues = await Game.distinct('league', filter);
        return res.status(200).json({ leagues: leagues.filter(Boolean).sort() });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};

/**
 * GET /api/odds/:id
 */
const getGameById = async (req, res) => {
    try {
        const game = await Game.findOne({ game_id: req.params.id }).lean();
        if (!game) return res.status(404).json({ error: 'Game not found' });
        return res.status(200).json(game);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};

module.exports = { syncOdds, forceScrape, getOdds, getSports, getLeagues, getGameById };
