const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
    const browser = await chromium.launch({
        headless: false,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
        ],
    });

    const context = await browser.newContext({
        viewport: { width: 1366, height: 900 },
    });

    const page = await context.newPage();

    try {
        console.log('Opening Betika...');
        await page.goto('https://www.betika.com/en-ke/', {
            waitUntil: 'domcontentloaded',
            timeout: 60000,
        });

        // Wait until match cards appear
        await page.waitForSelector('.prebet-match', { timeout: 30000 });

        // Optional: scroll a few times to load more matches (infinite scroll)
        for (let i = 0; i < 4; i++) {
            await page.mouse.wheel(0, 2000);
            await page.waitForTimeout(1200);
        }

        // Extract all matches
        const matches = await page.evaluate(() => {
            const cards = Array.from(document.querySelectorAll('.prebet-match'));

            return cards.map((card, index) => {
                // League + time
                const timeEl = card.querySelector('.time');
                let league = null;
                let kickoff = null;

                if (timeEl) {
                    const leagueSpan = timeEl.querySelector('span span');
                    league = leagueSpan ? leagueSpan.textContent.trim() : null;

                    // The date/time is usually the last text node
                    const fullText = timeEl.textContent.trim();
                    const timeMatch = fullText.match(/(\d{2}\/\d{2},\s*\d{2}:\d{2})/);
                    kickoff = timeMatch ? timeMatch[1] : null;
                }

                // Teams
                const teamsEl = card.querySelector('.prebet-match__teams');
                let home = null;
                let away = null;

                if (teamsEl) {
                    const homeEl = teamsEl.querySelector('.prebet-match__teams__home');
                    home = homeEl ? homeEl.textContent.trim() : null;

                    // Away is the second span
                    const spans = teamsEl.querySelectorAll('span');
                    if (spans.length >= 2) {
                        away = spans[1].textContent.trim();
                    }
                }

                // Odds (1, X, 2)
                const oddValues = Array.from(
                    card.querySelectorAll('.prebet-match__odd__odd-value')
                ).map((el) => el.textContent.trim());

                const odds = {
                    home: oddValues[0] || null, // 1
                    draw: oddValues[1] || null, // X
                    away: oddValues[2] || null, // 2
                };

                // Number of markets
                const marketsEl = card.querySelector('.prebet-match__markets');
                const marketsText = marketsEl ? marketsEl.textContent.trim() : null;
                const markets = marketsText
                    ? parseInt(marketsText.replace(/\D/g, '')) || null
                    : null;

                return {
                    index: index + 1,
                    league,
                    kickoff,
                    home,
                    away,
                    odds,
                    markets,
                };
            });
        });

        console.log(`\nFound ${matches.length} matches\n`);
        console.log(JSON.stringify(matches, null, 2));

        // Save to file
        fs.writeFileSync('betika-matches.json', JSON.stringify(matches, null, 2));
        console.log('\nSaved → betika-matches.json');
    } catch (err) {
        console.error('Error:', err.message);
    } finally {
        await browser.close();
    }
})();