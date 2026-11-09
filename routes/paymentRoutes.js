const express = require('express');
const router = express.Router();
const axios = require('axios');
const SlipLog = require('../models/SlipLog');

// ── Pricing ───────────────────────────────────────────────────────────────────
// KES 100 per 5-game bracket (in cents)
// 1-5  games → KES 100
// 6-10 games → KES 200
// 11-15 games → KES 300  … etc.
const PRICE_PER_BRACKET = 10000   // 100 KES in cents
const GAMES_PER_BRACKET = 5

function calcAmount(gameCount) {
    const brackets = Math.ceil(gameCount / GAMES_PER_BRACKET)
    return brackets * PRICE_PER_BRACKET
}

// ── Safe formatter ────────────────────────────────────────────────────────────
function safeFmt(val, dp = 2) {
    const n = parseFloat(val)
    return isNaN(n) ? '—' : n.toFixed(dp)
}

// ── Prediction generators ─────────────────────────────────────────────────────

/** 1X2 prediction using weighted-random from decimal odds */
function generate1X2(game) {
    const raw = game.odds || {}
    const pool = []
    const add = (name, label, v) => {
        const n = parseFloat(v)
        if (!isNaN(n) && n > 1) pool.push({ name, label, odd: n })
    }
    add('home', '1', raw.home)
    add('draw', 'X', raw.draw)
    add('away', '2', raw.away)

    const home = game.home_team || (game.match || '').split(' vs ')[0] || 'Home'
    const away = game.away_team || (game.match || '').split(' vs ')[1] || 'Away'

    if (!pool.length) {
        return {
            label: '1', outcome: 'home', odd: null, confidence: 50,
            reasoning: `No odds available — ${home} picked as default.`
        }
    }

    const weights = pool.map((o) => 1 / o.odd)
    const wTotal = weights.reduce((a, b) => a + b, 0)
    const norm = weights.map((w) => w / wTotal)

    let rand = Math.random()
    let picked = pool[pool.length - 1]
    for (let i = 0; i < pool.length; i++) {
        rand -= norm[i]
        if (rand <= 0) { picked = pool[i]; break }
    }

    const conf = Math.round(norm[pool.indexOf(picked)] * 100)
    const oddStr = safeFmt(picked.odd)

    const reasons = {
        home: `${home} are favoured at home (${oddStr}) — a win is the most likely outcome.`,
        draw: `The match looks evenly balanced (${oddStr}) — expect a hard-fought draw.`,
        away: `${away} are the value pick away (${oddStr}) — they have the edge here.`,
    }

    return {
        label: picked.label, outcome: picked.name, odd: picked.odd,
        confidence: conf, reasoning: reasons[picked.name]
    }
}

/** GG (Both Teams to Score) prediction */
function generateGG(game) {
    const raw = game.gg || {}
    const yes = parseFloat(raw.yes)
    const no = parseFloat(raw.no)

    const home = game.home_team || (game.match || '').split(' vs ')[0] || 'Home'
    const away = game.away_team || (game.match || '').split(' vs ')[1] || 'Away'

    // If no GG odds available, derive from 1X2: high-scoring games more likely GG
    if (isNaN(yes) || isNaN(no)) {
        const homeOdd = parseFloat(raw.home || (game.odds || {}).home)
        const awayOdd = parseFloat(raw.away || (game.odds || {}).away)
        // If both teams are competitive (neither > 4.0), lean GG Yes
        const likely = (!isNaN(homeOdd) && !isNaN(awayOdd) && homeOdd < 4 && awayOdd < 4)
        return {
            outcome: likely ? 'yes' : 'no',
            label: likely ? 'GG Yes' : 'GG No',
            odd: null,
            confidence: likely ? 58 : 55,
            reasoning: likely
                ? `Both ${home} and ${away} have strong attacking records — expect goals at both ends.`
                : `One side is dominant enough to keep a clean sheet here.`,
        }
    }

    // Weighted pick between yes and no
    const wYes = 1 / yes
    const wNo = 1 / no
    const total = wYes + wNo
    const pYes = wYes / total

    const goGG = Math.random() < pYes
    const picked = goGG ? yes : no
    const conf = Math.round((goGG ? pYes : 1 - pYes) * 100)
    const oddStr = safeFmt(picked)

    return {
        outcome: goGG ? 'yes' : 'no',
        label: goGG ? 'GG Yes' : 'GG No',
        odd: picked,
        confidence: conf,
        reasoning: goGG
            ? `Both ${home} and ${away} are likely to score (${oddStr}) — a goalfest is expected.`
            : `Expect a tight game — at least one side is likely to keep a clean sheet (${oddStr}).`,
    }
}

/** Build full prediction card with both 1X2 and GG */
function buildPredictionCard(game) {
    const pred1x2 = generate1X2(game)
    const predGG = generateGG(game)

    const home = game.home_team || (game.match || '').split(' vs ')[0] || '?'
    const away = game.away_team || (game.match || '').split(' vs ')[1] || '?'

    const pickLabel1x2 =
        pred1x2.outcome === 'home' ? `${home} to Win`
            : pred1x2.outcome === 'draw' ? 'Draw'
                : `${away} to Win`

    return {
        match: game.match || `${home} vs ${away}`,
        league: game.league || '',
        // 1X2
        h2h: {
            pick: pickLabel1x2,
            outcome: pred1x2.label,
            odd: pred1x2.odd != null ? safeFmt(pred1x2.odd) : '—',
            confidence: pred1x2.confidence,
            reasoning: pred1x2.reasoning,
            tip: `${pred1x2.label} @ ${pred1x2.odd != null ? safeFmt(pred1x2.odd) : '—'} · ${pred1x2.confidence}% confidence`,
        },
        // GG
        gg: {
            pick: predGG.label,
            outcome: predGG.outcome,
            odd: predGG.odd != null ? safeFmt(predGG.odd) : '—',
            confidence: predGG.confidence,
            reasoning: predGG.reasoning,
            tip: `${predGG.label} @ ${predGG.odd != null ? safeFmt(predGG.odd) : '—'} · ${predGG.confidence}% confidence`,
        },
    }
}

// ── Routes ────────────────────────────────────────────────────────────────────

/**
 * POST /api/payment/initialize
 * Body: { phone, games[] }
 * Derives amount from game count (100 per 5 games).
 */
router.post('/initialize', async (req, res) => {
    try {
        const { phone, games } = req.body

        if (!phone) return res.status(400).json({ error: 'phone is required' })
        if (!games?.length) return res.status(400).json({ error: 'At least one game required' })

        // Tiered pricing
        const amount = calcAmount(games.length)

        // Paystack requires an email — derive one from phone
        const digits = phone.replace(/\D/g, '')
        const email = `${digits}@oddshub.pay`

        // Log the slip attempt
        const slipLog = await SlipLog.create({
            phone,
            email,
            game_count: games.length,
            amount_cents: amount,
            games: games.map((g) => ({
                game_id: g.game_id,
                match: g.match,
                league: g.league,
                odds: g.odds,
                gg: g.gg,
            })),
            status: 'pending',
            ip: req.ip || '',
            userAgent: req.headers['user-agent'] || '',
        })

        const response = await axios.post(
            'https://api.paystack.co/transaction/initialize',
            {
                email,
                amount,
                currency: process.env.PAYSTACK_CURRENCY || 'KES',
                metadata: {
                    phone,
                    slip_log_id: slipLog._id.toString(),
                    games,
                    custom_fields: [{
                        display_name: 'Phone',
                        variable_name: 'phone',
                        value: phone,
                    }],
                },
                channels: ['card', 'mobile_money', 'bank'],
            },
            {
                headers: {
                    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
                    'Content-Type': 'application/json',
                },
            }
        )

        const { access_code, reference, authorization_url } = response.data.data

        // Save the reference to the log
        await SlipLog.findByIdAndUpdate(slipLog._id, { reference })

        return res.status(200).json({
            access_code,
            reference,
            authorization_url,
            amount,
            amount_display: `KES ${(amount / 100).toFixed(2)}`,
        })

    } catch (err) {
        const msg = err.response?.data?.message || err.message
        console.error('[Payment Init Error]', msg)
        return res.status(500).json({ error: msg })
    }
})

/**
 * GET /api/payment/verify/:reference
 * Adds a 3-second artificial delay before generating predictions
 * so users see the "Verifying odds…" loader (builds trust).
 */
router.get('/verify/:reference', async (req, res) => {
    try {
        const response = await axios.get(
            `https://api.paystack.co/transaction/verify/${req.params.reference}`,
            { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } }
        )

        const data = response.data.data

        if (data.status !== 'success') {
            return res.status(200).json({
                status: data.status,
                reference: data.reference,
                amount: data.amount,
                currency: data.currency,
                paid_at: data.paid_at,
            })
        }

        // 3-second "analysis" delay — makes prediction feel considered
        await new Promise((r) => setTimeout(r, 3000))

        // Generate predictions
        const games = data.metadata?.games || []
        const predictions = games.map(buildPredictionCard)

        // Update the slip log to paid
        const slipLogId = data.metadata?.slip_log_id
        if (slipLogId) {
            await SlipLog.findByIdAndUpdate(slipLogId, {
                status: 'paid',
                paid_at: new Date(data.paid_at || Date.now()),
            }).catch(() => { }) // non-critical
        }

        console.log(
            `[Payment] Verified ${data.reference} | ${games.length} games | ` +
            `${predictions.length} predictions generated`
        )

        return res.status(200).json({
            status: 'success',
            reference: data.reference,
            amount: data.amount,
            currency: data.currency,
            paid_at: data.paid_at,
            predictions,
        })

    } catch (err) {
        const msg = err.response?.data?.message || err.message
        console.error('[Payment Verify Error]', msg)
        return res.status(500).json({ error: msg })
    }
})

module.exports = router
