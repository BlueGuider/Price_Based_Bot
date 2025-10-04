#!/usr/bin/env node

/**
 * Test Existing Tokens Price Fetching
 * This script tests price fetching with known existing tokens
 */

const { SimplePriceBasedTradingService } = require('./simplePriceBasedTradingService');

class ExistingTokenTester {
  constructor() {
    this.tradingService = new SimplePriceBasedTradingService();
    this.publicClient = this.tradingService.publicClient;
    this.cachedBNBPrice = 1000; // Default fallback
    this.lastBNBPriceUpdate = 0;
    this.BNB_PRICE_CACHE_DURATION = 60000; // 1 minute cache
    
    // Rate limiting and batching
    this.priceUpdateQueue = [];
    this.isProcessingQueue = false;
    this.maxConcurrentRequests = 5; // Limit concurrent requests
    this.requestDelay = 200; // 200ms delay between batches
    this.tokenPriceCache = new Map(); // Cache token prices
    this.priceCacheDuration = 2000; // 2 seconds cache for token prices
  }

  async start() {
    console.log('🧪 Testing Existing Token Price Fetching...');
    console.log('='.repeat(60));
    
    try {
      // Load wallets
      await this.tradingService.loadAvailableWallets();
      console.log('✅ Wallets loaded');
      
      // Test with some known tokens (you can replace these with actual token addresses)
      const testTokens = [
        '0x4cc48d1b2006ee248961113a03bd4bfd25d04444', // Example token from your transaction
        '0x757eba15...90e226F85', // Another example
        // Add more test tokens here
      ];
      
      console.log(`🔍 Testing ${testTokens.length} existing tokens...`);
      console.log('='.repeat(60));
      
      // Test price fetching for each token
      for (const tokenAddress of testTokens) {
        console.log(`\n📊 Testing token: ${tokenAddress}`);
        await this.testTokenPrice(tokenAddress);
        await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay between tests
      }
      
      // Test the batched approach
      console.log('\n🔄 Testing batched price fetching...');
      console.log('='.repeat(60));
      
      // Add all tokens to queue
      for (const tokenAddress of testTokens) {
        this.priceUpdateQueue.push(tokenAddress);
      }
      
      // Process the queue
      await this.processPriceQueue();
      
      console.log('\n✅ Testing completed!');
      
    } catch (error) {
      console.error('❌ Failed to start:', error);
    }
  }

  async testTokenPrice(tokenAddress) {
    try {
      console.log(`   🔍 Fetching price for ${tokenAddress}...`);
      
      const priceResult = await this.getFourMemeExactPrice(tokenAddress);
      
      if (priceResult.success && priceResult.data) {
        const { buyPrice, sellPrice, avgPrice, priceUSD } = priceResult.data;
        
        console.log(`   ✅ Price fetched successfully:`);
        console.log(`      Buy:  ${buyPrice.toFixed(8)} BNB ($${priceUSD.toFixed(8)})`);
        console.log(`      Sell: ${sellPrice.toFixed(8)} BNB`);
        console.log(`      Avg:  ${avgPrice.toFixed(8)} BNB`);
        
        // Check thresholds
        const config = this.tradingService.getConfig();
        const currentBNBPrice = await this.getCachedBNBPrice();
        const migrationPriceUSD = config.trading.migrationPriceBNB * currentBNBPrice;
        
        console.log(`      Thresholds:`);
        console.log(`      Low: $${config.trading.lowThresholdUSD}`);
        console.log(`      High: $${config.trading.highThresholdUSD}`);
        console.log(`      Migration: $${migrationPriceUSD.toFixed(8)}`);
        
        if (priceUSD > config.trading.lowThresholdUSD) {
          console.log(`      🟢 ABOVE LOW THRESHOLD`);
        }
        if (priceUSD > config.trading.highThresholdUSD) {
          console.log(`      🔴 ABOVE HIGH THRESHOLD`);
        }
        if (priceUSD >= migrationPriceUSD) {
          console.log(`      🚨 AT MIGRATION PRICE`);
        }
        
      } else {
        console.log(`   ❌ Failed to fetch price: ${priceResult.error}`);
      }
    } catch (error) {
      console.error(`   ❌ Error testing ${tokenAddress}:`, error.message);
    }
  }

  async processPriceQueue() {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;
    
    console.log(`   📊 Processing ${this.priceUpdateQueue.length} tokens in batches...`);
    
    while (this.priceUpdateQueue.length > 0) {
      const batch = this.priceUpdateQueue.splice(0, this.maxConcurrentRequests);
      
      console.log(`   🔄 Processing batch of ${batch.length} tokens...`);
      
      // Process batch concurrently
      const promises = batch.map(tokenAddress => this.checkTokenPriceWithCache(tokenAddress));
      await Promise.allSettled(promises);
      
      // Delay between batches to respect rate limits
      if (this.priceUpdateQueue.length > 0) {
        console.log(`   ⏳ Waiting ${this.requestDelay}ms before next batch...`);
        await new Promise(resolve => setTimeout(resolve, this.requestDelay));
      }
    }
    
    this.isProcessingQueue = false;
    console.log(`   ✅ Queue processing completed!`);
  }

  async checkTokenPriceWithCache(tokenAddress) {
    const now = Date.now();
    const cached = this.tokenPriceCache.get(tokenAddress);
    
    // Check if we have valid cached price
    if (cached && (now - cached.timestamp) < this.priceCacheDuration) {
      console.log(`   💰 ${tokenAddress} (cached): $${cached.priceUSD.toFixed(8)}`);
      return cached;
    }
    
    // Cache expired or doesn't exist, fetch new price
    const result = await this.testTokenPrice(tokenAddress);
    if (result && result.success) {
      // Store with timestamp for cache management
      this.tokenPriceCache.set(tokenAddress, {
        ...result.data,
        timestamp: now
      });
    }
    return result;
  }

  async getFourMemeExactPrice(tokenAddress) {
    try {
      const TOKEN_MANAGER_HELPER = '0xF251F83e40a78868FcfA3FA4599Dad6494E46034';
      const TOKEN_MANAGER_HELPER_ABI = [
        {
          "inputs": [
            {"name": "token", "type": "address"},
            {"name": "amount", "type": "uint256"},
            {"name": "funds", "type": "uint256"}
          ],
          "name": "tryBuy",
          "outputs": [
            {"name": "", "type": "uint256"},
            {"name": "", "type": "uint256"},
            {"name": "", "type": "uint256"},
            {"name": "", "type": "uint256"},
            {"name": "", "type": "uint256"},
            {"name": "", "type": "uint256"},
            {"name": "", "type": "uint256"},
            {"name": "", "type": "uint256"}
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [
            {"name": "token", "type": "address"},
            {"name": "amount", "type": "uint256"}
          ],
          "name": "trySell",
          "outputs": [
            {"name": "", "type": "uint256"},
            {"name": "", "type": "uint256"},
            {"name": "", "type": "uint256"},
            {"name": "", "type": "uint256"}
          ],
          "stateMutability": "view",
          "type": "function"
        },
        {
          "inputs": [
            {"name": "token", "type": "address"}
          ],
          "name": "getTokenInfo",
          "outputs": [
            {"name": "version", "type": "uint256"},
            {"name": "tokenManager", "type": "address"},
            {"name": "quote", "type": "address"},
            {"name": "lastPrice", "type": "uint256"},
            {"name": "tradingFeeRate", "type": "uint256"},
            {"name": "minTradingFee", "type": "uint256"},
            {"name": "launchTime", "type": "uint256"},
            {"name": "offers", "type": "uint256"},
            {"name": "maxOffers", "type": "uint256"},
            {"name": "funds", "type": "uint256"},
            {"name": "maxFunds", "type": "uint256"},
            {"name": "liquidityAdded", "type": "bool"}
          ],
          "stateMutability": "view",
          "type": "function"
        }
      ];

      // First, try to get token info to check if it's properly initialized
      let tokenInfo = null;
      try {
        const infoResult = await this.publicClient.readContract({
          address: TOKEN_MANAGER_HELPER,
          abi: TOKEN_MANAGER_HELPER_ABI,
          functionName: 'getTokenInfo',
          args: [tokenAddress]
        });
        
        if (infoResult && infoResult.length >= 12) {
          tokenInfo = {
            version: Number(infoResult[0]),
            tokenManager: infoResult[1],
            quote: infoResult[2],
            lastPrice: Number(infoResult[3]),
            tradingFeeRate: Number(infoResult[4]),
            minTradingFee: Number(infoResult[5]),
            launchTime: Number(infoResult[6]),
            offers: Number(infoResult[7]),
            maxOffers: Number(infoResult[8]),
            funds: Number(infoResult[9]),
            maxFunds: Number(infoResult[10]),
            liquidityAdded: Boolean(infoResult[11])
          };
          
          console.log(`   Token Info: Version ${tokenInfo.version}, Funds: ${(tokenInfo.funds/1e18).toFixed(6)} BNB, Liquidity: ${tokenInfo.liquidityAdded}`);
          console.log(`   LastPrice: ${(tokenInfo.lastPrice/1e18).toFixed(8)} BNB`);
        }
      } catch (error) {
        console.log(`   ⚠️ Could not get token info: ${error.message}`);
      }

      // Use token info lastPrice as the primary price source (most accurate)
      if (tokenInfo && tokenInfo.lastPrice > 0) {
        const realPrice = Number(tokenInfo.lastPrice) / 1e18;
        const bnbPriceUSD = await this.getCachedBNBPrice();
        const priceUSD = realPrice * bnbPriceUSD;
        console.log(`   Using lastPrice (primary): ${realPrice.toFixed(8)} BNB ($${priceUSD.toFixed(8)})`);
        console.log(`   BNB Price (cached): $${bnbPriceUSD.toFixed(2)}`);
        return { success: true, data: { buyPrice: realPrice, sellPrice: realPrice, avgPrice: realPrice, priceUSD } };
      }

      // Skip simulations for rate limiting - use lastPrice only
      return { success: false, error: 'Token may be too new or not have liquidity yet' };

    } catch (error) {
      console.error(`❌ Error getting exact price for ${tokenAddress}:`, error.message);
      return { success: false, error: error.message };
    }
  }

  async getCachedBNBPrice() {
    const now = Date.now();
    
    // Check if cache is still valid (1 minute)
    if (now - this.lastBNBPriceUpdate < this.BNB_PRICE_CACHE_DURATION) {
      return this.cachedBNBPrice;
    }
    
    // Cache expired, fetch new price
    try {
      console.log('   🔄 Updating BNB price cache...');
      const newPrice = await this.getRealBNBPrice();
      this.cachedBNBPrice = newPrice;
      this.lastBNBPriceUpdate = now;
      console.log(`   ✅ BNB price updated: $${newPrice.toFixed(2)}`);
      return newPrice;
    } catch (error) {
      console.log(`   ⚠️ Failed to update BNB price, using cached: $${this.cachedBNBPrice.toFixed(2)}`);
      return this.cachedBNBPrice;
    }
  }

  async getRealBNBPrice() {
    try {
      const PANCAKESWAP_ROUTER_V2 = '0x10ED43C718714eb63d5aA57B78B54704E256024E';
      const WBNB_ADDRESS = '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c';
      const USDT_ADDRESS = '0x55d398326f99059fF775485246999027B3197955';
      
      const PANCAKESWAP_ROUTER_ABI = [
        {
          'inputs': [
            {'name': 'amountIn', 'type': 'uint256'},
            {'name': 'path', 'type': 'address[]'}
          ],
          'name': 'getAmountsOut',
          'outputs': [
            {'name': 'amounts', 'type': 'uint256[]'}
          ],
          'stateMutability': 'view',
          'type': 'function'
        }
      ];
      
      const amountsOut = await this.publicClient.readContract({
        address: PANCAKESWAP_ROUTER_V2,
        abi: PANCAKESWAP_ROUTER_ABI,
        functionName: 'getAmountsOut',
        args: [
          BigInt(1e18), // 1 BNB
          [WBNB_ADDRESS, USDT_ADDRESS] // WBNB -> USDT
        ]
      });
      
      if (amountsOut && amountsOut.length >= 2) {
        return Number(amountsOut[1]) / 1e18;
      }
      
      return 1000; // Fallback BNB price
    } catch (error) {
      console.log(`   ⚠️ Could not get BNB price: ${error.message}`);
      return 1000; // Fallback BNB price
    }
  }
}

// Start the tester
const tester = new ExistingTokenTester();
tester.start().catch(console.error);


