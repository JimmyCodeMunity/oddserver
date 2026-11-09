const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../middleware/auth');
const {
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
} = require('../controllers/adminController');

// Public
router.post('/login', login);

// Protected
router.use(requireAdmin);

router.get('/stats', getStats);
router.get('/settings', getSettings);
router.put('/settings', updateSettings);
router.get('/games', getAdminGames);
router.patch('/games/:game_id/hide', toggleHideGame);
router.patch('/games/:game_id/feature', toggleFeatureGame);
router.post('/sync', adminSync);
router.post('/force-scrape', adminForceScrape);
router.get('/slip-logs', getSlipLogs);

module.exports = router;
