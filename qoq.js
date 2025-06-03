
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth'

puppeteer.use(StealthPlugin());
import axios from 'axios';

// Set your WordPress REST API endpoint here
const wpApiUrl = 'https://profitbooking.in/wp-json/scraper/v1/stockedge-results';

async function extractStockData() {
  // Launch the browser
  const browser = await puppeteer.launch({
    headless: true,
     timeout: 0,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process',
      '--disable-extensions',
      '--disable-blink-features=AutomationControlled', 
    '--window-size=1920,1080'
    ],
    ignoreHTTPSErrors: true,
  });
  const page = await browser.newPage();
  
  // Navigate to the page
  await page.goto('https://web.stockedge.com/daily-updates?section=released-results&result-type=QoQ', {
    waitUntil: 'networkidle2',
  });
  
  // Wait for ion-items to load
  await page.waitForSelector('ion-item[se-item]');
  
  // Extract data from all ion-items
  const stockData = await page.evaluate(() => {
    const items = document.querySelectorAll('ion-item[se-item]');
    const results = [];
    
    items.forEach(item => {
      // Company name
      const companyName = item.querySelector('.normal-font')?.textContent?.trim();
      
      // Quarter and type
      const quarterInfo = item.querySelector('ion-text[id*="released-result-Qtr-txt"]')?.textContent?.trim();
      
      // Market Cap
      const mcapText = Array.from(item.querySelectorAll('ion-text.small-font'))
        .find(el => el.textContent.includes('MCap:'))?.nextElementSibling?.textContent?.trim();
      
      // Sales data
      const salesValue = item.querySelector('div[id*="released-result-SALES-txt"] ion-text')?.textContent?.trim();
      const salesGrowth = item.querySelector('ion-text[id*="released-result-SALESZG-txt"]')?.textContent?.trim();
      
      // EBITDA data
      const ebitdaValue = item.querySelector('div[id*="released-result-EBITDA-txt"] ion-text')?.textContent?.trim();
      const ebitdaGrowth = item.querySelector('ion-text[id*="released-result-EBITDAZG-txt"]')?.textContent?.trim();
      
      // Profit data
      const profitValue = item.querySelector('ion-col:nth-child(4) div:first-child ion-text')?.textContent?.trim();
      const profitGrowth = item.querySelector('ion-text[id*="released-result-ProfitZG-txt"]')?.textContent?.trim();
      
      // Extract date from quarter info (assuming format like "Q4FY24 (Standalone)" or similar)
      let reportDate = new Date().toISOString().split('T')[0]; // Default to today
      if (quarterInfo) {
        // Extract current year from the quarter info if possible
        const currentYear = new Date().getFullYear();
        reportDate = `${currentYear}-${new Date().getMonth() + 1}-${new Date().getDate()}`;
      }
      
      results.push({
        companyName,
        quarterInfo,
        reportDate,
        marketCap: mcapText,
        sales: {
          value: salesValue,
          growth: salesGrowth
        },
        ebitda: {
          value: ebitdaValue,
          growth: ebitdaGrowth
        },
        profit: {
          value: profitValue,
          growth: profitGrowth
        }
      });
    });
    
    return results;
  });
  
  // Close the browser
  await browser.close();
  
  // Store data in WordPress
  for (const item of stockData) {
    try {
      await storeInWordPress(item);
      console.log(`Successfully stored data for "${item.companyName}"`);
    } catch (error) {
      console.error(`Failed to store data for "${item.companyName}":`, error.message);
    }
  }
  
  return stockData;
}

async function storeInWordPress(data) {
  try {
    // Format the data according to the WordPress API requirements
    const wpData = {
      date: data.reportDate,
      companyName: data.companyName,
      quarterInfo: data.quarterInfo,
      marketCap: data.marketCap,
      salesValue: data.sales.value,
      salesGrowth: data.sales.growth,
      ebitdaValue: data.ebitda.value,
      ebitdaGrowth: data.ebitda.growth,
      profitValue: data.profit.value,
      profitGrowth: data.profit.growth
    };
    
    const response = await axios.post(wpApiUrl, wpData);
    console.log('WordPress response:', response.data);
    return response.data;
  } catch (error) {
    console.error('WordPress API Error:', error.response?.data || error.message);
    if (error.response?.data?.code === 'duplicate_entry') {
      return { duplicate: true };
    }
    throw error;
  }
}

// Execute the function
extractStockData()
  .then(data => {
    console.log('Extraction complete. Total records:', data.length);
  })
  .catch(err => {
    console.error('Error extracting stock data:', err);
  });

export default extractStockData;
