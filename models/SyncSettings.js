const mongoose = require('mongoose');

/**
 * Singleton settings document (_id = 'global').
 * Controls what the admin can configure about scraping and game visibility.
 */
const syncSettingsSchema = new mongoose.Schema({
    _id: { type: String, default: 'global' },

    // Betika URL to scrape (allows switching region/locale from admin)
    scrapeUrl: {
        type: String,
        default: 'https://www.betika.com/en-ke/',
    },

    // How many scroll steps to take on the page (more = more matches loaded)
    scrollSteps: { type: Number, default: 6 },

    // Run scraper headless? (true for production, false for debugging)
    headless: { type: Boolean, default: true },

    // Games hidden from the public feed
    hiddenGames: { type: [String], default: [] },

    // Games pinned to the top of the public feed
    featuredGames: { type: [String], default: [] },

    updatedBy: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.model('SyncSettings', syncSettingsSchema);
