const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const cron = require('node-cron');

const oddsRoutes = require('./routes/oddsRoutes');
const adminRoutes = require('./routes/adminRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const { syncOdds } = require('./controllers/oddsController');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

app.get('/', (_req, res) => res.send('PredictorServer up — powered by Betika scraper'));
app.get('/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() }));
app.use('/api/odds', oddsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/payment', paymentRoutes);

mongoose
    .connect(process.env.MONGO_URI)
    .then(() => {
        console.log('MongoDB connected');

        // Scrape Betika every 6 hours — no API credits needed
        cron.schedule('0 */6 * * *', async () => {
            console.log(`[Cron] Starting Betika scrape at ${new Date().toISOString()}`);
            await syncOdds(null, null);
        });

        // Initial scrape on startup
        console.log('[Startup] Running initial Betika scrape…');
        syncOdds(null, null);

        app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
    })
    .catch((err) => {
        console.error('MongoDB connection error:', err.message);
        process.exit(1);
    });
