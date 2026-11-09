/**
 * Run once to create the first admin account.
 * Usage: node scripts/seedAdmin.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Admin = require('../models/Admin');

const EMAIL = process.env.ADMIN_EMAIL || 'admin@oddshub.com';
const PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@1234';

async function seed() {
    await mongoose.connect(process.env.MONGO_URI);
    const existing = await Admin.findOne({ email: EMAIL });
    if (existing) {
        console.log(`Admin already exists: ${EMAIL}`);
        process.exit(0);
    }
    await Admin.create({ email: EMAIL, password: PASSWORD });
    console.log(`✅ Admin created: ${EMAIL} / ${PASSWORD}`);
    console.log('⚠️  Change the password after first login!');
    process.exit(0);
}

seed().catch((err) => { console.error(err); process.exit(1); });
