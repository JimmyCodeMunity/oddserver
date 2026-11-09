const mongoose = require('mongoose');

/**
 * Tracks every user interaction with the prediction slip.
 * Created on init, updated on verify or abandon.
 */
const slipLogSchema = new mongoose.Schema({
    // Paystack reference (set after init, null for abandoned carts)
    reference: { type: String, default: null, index: true },

    // Phone number provided by user
    phone: { type: String, default: '' },

    // Synthetic email used with Paystack
    email: { type: String, default: '' },

    // Number of games selected
    game_count: { type: Number, default: 0 },

    // Amount charged in cents
    amount_cents: { type: Number, default: 0 },

    // Snapshot of selected games
    games: [{
        game_id: String,
        match: String,
        league: String,
        odds: Object,
        gg: Object,
    }],

    // Status: pending → paid | abandoned
    status: { type: String, enum: ['pending', 'paid', 'abandoned'], default: 'pending' },
    paid_at: { type: Date, default: null },

    // IP / user-agent for analytics (optional)
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },

}, { timestamps: true });

module.exports = mongoose.model('SlipLog', slipLogSchema);
