const express = require('express');
const router = express.Router();
const { syncOdds, getOdds, getSports, getLeagues, getGameById } = require('../controllers/oddsController');

// Public — no auth required

router.get('/', getOdds);       // list games with filters
router.get('/sports', getSports);     // distinct sport keys
router.get('/leagues', getLeagues);    // distinct leagues
router.get('/:id', getGameById);   // single game

router.post('/sync', syncOdds);      // manually trigger scrape (public — can lock down later)

module.exports = router;
