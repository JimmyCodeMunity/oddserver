const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');
const SyncSettings = require('../models/SyncSettings');
const Game = require('../models/Game');
const SlipLog = require('../models/SlipLog');
const { syncOdds, forceScrape } = require('./oddsController');

// ── Auth ──────────────────────────────────────────────────────────────────────

const login = async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password)
            return res.status(400).json({ error: 'Email and password required' });

        const admin = await Admin.findOne({ email: email.toLowerCase() });
        if (!admin) return res.status(401).json({ error: 'Invalid credentials' });

        const ok = await admin.comparePassword(password);
        if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

        const token = jwt.sign(
            { id: admin._id, email: admin.email },
            process.env.JWT_SECRET,
            { expiresIn: '8h' }
        );

        return res.status(200).json({ token, email: admin.email });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};

// ── Sync settings ─────────────────────────────────────────────────────────────

const getSettings = async (req, res) => {
    try {
        const s = await SyncSettings.findById('global');
        return res.status(200).json(s || {});
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};

const updateSettings = async (req, res) => {
    try {
        const { scrapeUrl, scrollSteps, headless } = req.body;
        const patch = { updatedBy: req.admin.email };
        if (scrapeUrl !== undefined) patch.scrapeUrl = scrapeUrl;
        if (scrollSteps !== undefined) patch.scrollSteps = parseInt(scrollSteps);
        if (headless !== undefined) patch.headless = Boolean(headless);

        const settings = await SyncSettings.findByIdAndUpdate(
            'global',
            { $set: patch },
            { upsert: true, new: true }
        );
        return res.status(200).json(settings);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};

// ── Game visibility ───────────────────────────────────────────────────────────

const toggleHideGame = async (req, res) => {
    try {
        const { game_id } = req.params;
        let settings = await SyncSettings.findById('global');
        if (!settings) settings = new SyncSettings({ _id: 'global' });

        const isHidden = settings.hiddenGames.includes(game_id);
        settings.hiddenGames = isHidden
            ? settings.hiddenGames.filter((id) => id !== game_id)
            : [...settings.hiddenGames, game_id];
        await settings.save();

        return res.status(200).json({ game_id, hidden: !isHidden });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};

const toggleFeatureGame = async (req, res) => {
    try {
        const { game_id } = req.params;
        let settings = await SyncSettings.findById('global');
        if (!settings) settings = new SyncSettings({ _id: 'global' });

        const isFeatured = settings.featuredGames.includes(game_id);
        settings.featuredGames = isFeatured
            ? settings.featuredGames.filter((id) => id !== game_id)
            : [...settings.featuredGames, game_id];
        await settings.save();

        return res.status(200).json({ game_id, featured: !isFeatured });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};

// ── Sync triggers ─────────────────────────────────────────────────────────────

/** Full scrape — same as cron */
const adminSync = (req, res) => syncOdds(req, res);

/** Force scrape — alias, used from the admin UI */
const adminForceScrape = (req, res) => forceScrape(req, res);

// ── Stats ─────────────────────────────────────────────────────────────────────

const getStats = async (req, res) => {
    try {
        const [totalGames, settings] = await Promise.all([
            Game.countDocuments(),
            SyncSettings.findById('global'),
        ]);

        const upcomingGames = await Game.countDocuments({ commence_time: { $gte: new Date() } });
        const sports = await Game.distinct('sport_key');
        const lastSync = await Game.findOne().sort({ fetched_at: -1 }).select('fetched_at').lean();

        return res.status(200).json({
            totalGames,
            upcomingGames,
            hiddenGames: settings?.hiddenGames?.length || 0,
            featuredGames: settings?.featuredGames?.length || 0,
            totalSports: sports.length,
            lastSync: lastSync?.fetched_at || null,
            settings,
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};

// ── Games list (admin — includes hidden) ──────────────────────────────────────

const getAdminGames = async (req, res) => {
    try {
        const { sport, league, page = 1, limit = 25 } = req.query;
        const settings = await SyncSettings.findById('global');

        const filter = {};
        if (sport) filter.sport_key = sport;
        if (league) filter.league = new RegExp(league, 'i');

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const total = await Game.countDocuments(filter);
        const games = await Game.find(filter)
            .sort({ commence_time: 1 })
            .skip(skip)
            .limit(parseInt(limit))
            .lean();

        const hiddenSet = new Set(settings?.hiddenGames || []);
        const featuredSet = new Set(settings?.featuredGames || []);

        return res.status(200).json({
            total,
            page: parseInt(page),
            pages: Math.ceil(total / parseInt(limit)),
            games: games.map((g) => ({
                ...g,
                isHidden: hiddenSet.has(g.game_id),
                isFeatured: featuredSet.has(g.game_id),
            })),
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};

// ── Slip logs (user activity tracking) ───────────────────────────────────────

const getSlipLogs = async (req, res) => {
    try {
        const { status, page = 1, limit = 50 } = req.query;
        const filter = {};
        if (status) filter.status = status;

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const total = await SlipLog.countDocuments(filter);
        const logs = await SlipLog.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit))
            .lean();

        // Summary stats
        const [paid, pending, abandoned] = await Promise.all([
            SlipLog.countDocuments({ status: 'paid' }),
            SlipLog.countDocuments({ status: 'pending' }),
            SlipLog.countDocuments({ status: 'abandoned' }),
        ]);

        // Revenue: sum of amount_cents for paid logs
        const revenueAgg = await SlipLog.aggregate([
            { $match: { status: 'paid' } },
            { $group: { _id: null, total: { $sum: '$amount_cents' } } },
        ]);
        const totalRevenueCents = revenueAgg[0]?.total || 0;

        return res.status(200).json({
            total,
            page: parseInt(page),
            pages: Math.ceil(total / parseInt(limit)),
            stats: {
                paid,
                pending,
                abandoned,
                total_revenue_kes: (totalRevenueCents / 100).toFixed(2),
            },
            logs,
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};

module.exports = {
    login,
    getSettings,
    updateSettings,
    toggleHideGame,
    toggleFeatureGame,
    adminSync,
    adminForceScrape,
    getStats,
    getAdminGames,
    getSlipLogs,
};
