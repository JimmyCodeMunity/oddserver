const mongoose = require('mongoose');

const oddsSchema = new mongoose.Schema({
    home: { type: Number, default: null },  // "1" — home win
    draw: { type: Number, default: null },  // "X" — draw
    away: { type: Number, default: null },  // "2" — away win
}, { _id: false });

const ggSchema = new mongoose.Schema({
    yes: { type: Number, default: null },   // Both Teams to Score — Yes
    no: { type: Number, default: null },   // Both Teams to Score — No
}, { _id: false });

const gameSchema = new mongoose.Schema({
    game_id: { type: String, required: true, unique: true },
    league: { type: String, default: '' },
    sport_key: { type: String, default: 'soccer' },
    commence_time: { type: Date, required: true },
    home_team: { type: String, required: true },
    away_team: { type: String, required: true },
    odds: { type: oddsSchema, default: () => ({}) },  // 1X2
    gg: { type: ggSchema, default: () => ({}) },  // Both Teams to Score
    markets_count: { type: Number, default: null },
    source: { type: String, default: 'betika' },
    fetched_at: { type: Date, default: Date.now },
}, { timestamps: true });

gameSchema.index({ sport_key: 1 });
gameSchema.index({ commence_time: 1 });
gameSchema.index({ league: 1 });

module.exports = mongoose.model('Game', gameSchema);
