import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth'

puppeteer.use(StealthPlugin());
import axios from 'axios'; 
import dotenv from 'dotenv';

dotenv.config();

const wpApiUrl = 'https://profitbooking.in/wp-json/scraper/v1/stockedge-sector-data'; 

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function extractSectorAndChangePercentage(url) { 
  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1200, height: 800 },
    timeout: 0,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process',
      '--disable-extensions',
      '--disable-blink-features=AutomationControlled', 
      '--window-size=1920,1080',
      '--start-maximized'
    ],
    ignoreHTTPSErrors: true,
  });
  
  try {
    console.log('Opening new page...');
    const page = await browser.newPage();
    
    console.log(`Navigating to ${url}...`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    
    // Enhanced scrolling function to load all content
    console.log('Starting to scroll and load all content...');
    const scrollToLoadAllContent = async () => {
      let previousHeight = 0;
      let scrollAttempts = 0;
      const maxScrollAttempts = 50; // Prevent infinite loops
      
      while (scrollAttempts < maxScrollAttempts) {
        // Scroll to bottom
        await page.evaluate(() => {
          window.scrollTo(0, document.body.scrollHeight);
        });
        
        // Wait for content to load
        await delay(2000);
        
        // Get current height
        const newHeight = await page.evaluate(() => document.body.scrollHeight);
        
        console.log(`Scroll attempt ${scrollAttempts + 1}: Height ${previousHeight} -> ${newHeight}`);
        
        // Break if no new content loaded
        if (newHeight === previousHeight) {
          console.log('No more content to load. Scrolling complete.');
          break;
        }
        
        previousHeight = newHeight;
        scrollAttempts++;
      }
      
      if (scrollAttempts >= maxScrollAttempts) {
        console.log('Reached maximum scroll attempts. Proceeding with extraction.');
      }
    };

    await scrollToLoadAllContent();
    
    // Wait a bit more for any final lazy-loaded content
    console.log('Waiting for final content to stabilize...');
    await delay(3000);
    
    
    
    console.log('Extracting data from all loaded items...');
    const results = await page.evaluate(() => {
      const data = [];
      const ionItems = document.querySelectorAll('ion-item[se-item]');
      
      console.log(`Found ${ionItems.length} ion-item elements`);
      
      ionItems.forEach((item, index) => {
        try {
          const industryText = item.querySelector('ion-text.normal-font')?.textContent?.trim();
          const stockCountElement = item.querySelector('ion-text.ion-color-se-grey-medium');
          
          let changePercent = '';
          const changePercentElement = item.querySelector('se-price-change-percent-label ion-text');
          if (changePercentElement) {
            changePercent = changePercentElement.textContent.trim();
          }
          
          // Only add items with valid industry text
          if (industryText) {
            data.push({
              index: index + 1,
              industry: industryText,
              changePercent: changePercent
            });
          }
        } catch (error) {
          console.error(`Error processing item ${index + 1}:`, error);
        }
      });
      
      return data;
    });
    
    console.log(`Successfully extracted ${results.length} sector items`);
    return results;
  } catch (error) {
    console.error('An error occurred during extraction:', error);
    throw error;
  } finally {
    await browser.close();
    console.log('Browser closed.');
  }
}

async function main() {
  const targetUrl = 'https://web.stockedge.com/sectors';
  try {
    console.log('Starting sector data extraction...');
    const data = await extractSectorAndChangePercentage(targetUrl);
    
    console.log('\nExtraction complete!');
    console.log('='.repeat(50));
    
    if (data && data.length > 0) {
      console.table(data.map(item => ({
        '#': item.index,
        'Sector/Industry': item.industry,
        'Change %': item.changePercent
      })));
      
      console.log(`\nStarting WordPress storage for ${data.length} items...`);
      let successCount = 0;
      let duplicateCount = 0;
      let errorCount = 0;
      
      for (const item of data) {
        const wpData = { 
          industry: item.industry,
          change_percent: item.changePercent
        };
        
        const stored = await storeInWordPress(wpData);
        if (stored === true) {
          successCount++;
          console.log(`✓ Successfully stored "${item.industry}"`);
        } else if (stored?.duplicate) {
          duplicateCount++;
          console.log(`⚠ Skipped duplicate: "${item.industry}"`);
        } else {
          errorCount++;
          console.log(`✗ Failed to store "${item.industry}"`);
        }
        
        // Small delay between API calls to be respectful
        await delay(500);
      }
      
      console.log('\n' + '='.repeat(50));
      console.log('SUMMARY:');
      console.log(`Total items processed: ${data.length}`);
      console.log(`Successfully stored: ${successCount}`);
      console.log(`Duplicates skipped: ${duplicateCount}`);
      console.log(`Errors: ${errorCount}`);
      console.log('='.repeat(50));
    } else {
      console.log('No data extracted. Please check the selectors or website structure.');
    }

    return data;
    
  } catch (error) {
    console.error('Failed to extract data:', error);
    process.exit(1);
  }
}

async function storeInWordPress(data) {
  try {
    const response = await axios.post(wpApiUrl, {
      industry: data.industry,
      change_percent: data.change_percent
    }, {
      timeout: 10000 // 10 second timeout
    });

    return response.data.status === 'duplicate' ? { duplicate: true } : true;
  } catch (error) {
    console.error('WP API Error:', error.response?.data || error.message);
    return false;
  }
}

main();