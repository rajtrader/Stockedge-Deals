import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
puppeteer.use(StealthPlugin());

async function scrapeSectors() {
    console.log('Starting sector data extraction...');
    const browser = await puppeteer.launch({
        headless: false,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--start-maximized'] // Maximize window for better visibility
    });

    try {
        console.log('Launching browser...');
        const page = await browser.newPage();
        console.log('Opening new page...');

        // Set a larger viewport to ensure more content is visible initially
        await page.setViewport({ width: 1366, height: 768 });

        await page.goto('https://web.stockedge.com/sectors', {
            waitUntil: 'networkidle2', // Wait until network is idle
            timeout: 60000
        });

        console.log('Starting to scroll and load all content...');

        let lastHeight = 0;
        let currentHeight = await page.evaluate(() => document.body.scrollHeight);
        let scrollAttempts = 0;
        const maxScrollAttempts = 20; // Increased max attempts
        let itemsCount = 0;

        const autoScroll = async () => {
            while (scrollAttempts < maxScrollAttempts) {
                scrollAttempts++;
                lastHeight = currentHeight;

                // Scroll to the bottom of the page
                await page.evaluate(() => {
                    window.scrollTo(0, document.body.scrollHeight);
                });

                // Wait for a short period to allow content to load
                await page.waitForTimeout(2000); // Increased wait time slightly

                currentHeight = await page.evaluate(() => document.body.scrollHeight);
                console.log(`Scroll attempt ${scrollAttempts}: Height ${lastHeight} -> ${currentHeight}`);

                // Check if the scroll actually moved the scrollbar
                if (currentHeight === lastHeight) {
                    console.log('No new content loaded after scroll (height unchanged).');
                    // Before breaking, try a small scroll to trigger lazy loading if any
                    await page.evaluate(() => window.scrollBy(0, 100)); // Scroll down a little bit more
                    await page.waitForTimeout(1000);
                    currentHeight = await page.evaluate(() => document.body.scrollHeight);
                    if (currentHeight === lastHeight) {
                        console.log('Confirmed: No more content to load. Scrolling complete.');
                        break; // No more content to load
                    }
                }

                // Check if new items have appeared
                const newItemsCount = await page.evaluate(() =>
                    document.querySelectorAll('.sector-item').length
                );

                if (newItemsCount > itemsCount) {
                    itemsCount = newItemsCount;
                    console.log(`Now have ${itemsCount} items loaded`);
                    scrollAttempts = 0; // Reset scroll attempts if new items were found, to continue loading
                } else if (newItemsCount === itemsCount && currentHeight === lastHeight) {
                    console.log('No new items and no scroll progress. Assuming all content loaded.');
                    break;
                }
            }
        };

        await autoScroll();

        console.log('Waiting for final content to stabilize...');
        await page.waitForTimeout(3000); // Give it a bit more time after scrolling stops

        console.log('Extracting data from all loaded items...');
        const sectors = await page.evaluate(() => {
            const items = Array.from(document.querySelectorAll('.sector-item'));
            return items.map(item => {
                return {
                    name: item.querySelector('.sector-name')?.textContent.trim() || '',
                    change: item.querySelector('.sector-change')?.textContent.trim() || '',
                    volume: item.querySelector('.sector-volume')?.textContent.trim() || ''
                };
            });
        });

        console.log(`Successfully extracted ${sectors.length} sector items`);

        // Removed the conditional "additional scroll" as autoScroll should handle it.
        // The autoScroll function with reset of scrollAttempts is more robust.

        return sectors;

    } catch (error) {
        console.error('Error during scraping:', error);
        throw error;
    } finally {
        await browser.close();
        console.log('Browser closed.');
    }
}

scrapeSectors().then(results => {
    console.log('Final results:', results);
    console.log(`Total sectors extracted: ${results.length}`);
}).catch(error => {
    console.error('Scraping failed:', error);
});