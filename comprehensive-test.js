#!/usr/bin/env node

/**
 * Comprehensive Token Price Testing
 * This script demonstrates the complete price fetching and monitoring system
 */

const { SimplePriceBasedTradingService } = require('./simplePriceBasedTradingService');

class ComprehensiveTester {
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
    
    // Test with a known working token
    this.testToken = '0x4cc48d1b2006ee248961113a03bd4bfd25d04444';
  }

  async start() {
    console.log('🧪 Comprehensive Token Price Testing...');
    console.log('='.repeat(60));
    
    try {
      // Load wallets
      await this.tradingService.loadAvailableWallets();
      console.log('✅ Wallets loaded');
      
      // Test 1: Single token price fetch
      console.log('\n📊 TEST 1: Single Token Price Fetch');
      console.log('='.repeat(40));
      await this.testSingleToken();
      
      // Test 2: Caching mechanism
      console.log('\n📊 TEST 2: Caching Mechanism');
      console.log('='.repeat(40));
      await this.testCaching();
      
      // Test 3: Batched processing
      console.log('\n📊 TEST 3: Batched Processing');
      console.log('='.repeat(40));
      await this.testBatching();
      
      // Test 4: Continuous monitoring simulation
      console.log('\n📊 TEST 4: Continuous Monitoring Simulation');
      console.log('='.repeat(40));
      await this.testContinuousMonitoring();
      
      console.log('\n✅ All tests completed successfully!');
      
    } catch (error) {
      console.error('❌ Failed to start:', error);
    }
  }

  async testSingleToken() {
    console.log(`🔍 Testing single token: ${this.testToken}`);
    
    const startTime = Date.now();
    const result = await this.getFourMemeExactPrice(this.testToken);
    const endTime = Date.now();
    
    if (result.success) {
      const { buyPrice, sellPrice, avgPrice, priceUSD } = result.data;
      console.log(`✅ Price fetched in ${endTime - startTime}ms:`);
      console.log(`   Buy:  ${buyPrice.toFixed(8)} BNB ($${priceUSD.toFixed(8)})`);
      console.log(`   Sell: ${sellPrice.toFixed(8)} BNB`);
      console.log(`   Avg:  ${avgPrice.toFixed(8)} BNB`);
      
      // Check thresholds
      const config = this.tradingService.getConfig();
      const currentBNBPrice = await this.getCachedBNBPrice();
      const migrationPriceUSD = config.trading.migrationPriceBNB * currentBNBPrice;
      
      console.log(`   Thresholds:`);
      console.log(`   Low: $${config.trading.lowThresholdUSD}`);
      console.log(`   High: $${config.trading.highThresholdUSD}`);
      console.log(`   Migration: $${migrationPriceUSD.toFixed(8)}`);
      
      if (priceUSD > config.trading.lowThresholdUSD) {
        console.log(`   🟢 ABOVE LOW THRESHOLD`);
      }
      if (priceUSD > config.trading.highThresholdUSD) {
        console.log(`   🔴 ABOVE HIGH THRESHOLD`);
      }
      if (priceUSD >= migrationPriceUSD) {
        console.log(`   🚨 AT MIGRATION PRICE`);
      }
    } else {
      console.log(`❌ Failed: ${result.error}`);
    }
  }

  async testCaching() {
    console.log(`🔄 Testing caching mechanism...`);
    
    // First fetch (should be slow)
    console.log(`   First fetch (should be slow):`);
    const start1 = Date.now();
    await this.checkTokenPriceWithCache(this.testToken);
    const end1 = Date.now();
    console.log(`   Time: ${end1 - start1}ms`);
    
    // Second fetch (should be fast - cached)
    console.log(`   Second fetch (should be fast - cached):`);
    const start2 = Date.now();
    await this.checkTokenPriceWithCache(this.testToken);
    const end2 = Date.now();
    console.log(`   Time: ${end2 - start2}ms`);
    
    // Wait for cache to expire
    console.log(`   Waiting for cache to expire (2 seconds)...`);
    await new Promise(resolve => setTimeout(resolve, 2100));
    
    // Third fetch (should be slow again)
    console.log(`   Third fetch (cache expired, should be slow):`);
    const start3 = Date.now();
    await this.checkTokenPriceWithCache(this.testToken);
    const end3 = Date.now();
    console.log(`   Time: ${end3 - start3}ms`);
  }

  async testBatching() {
    console.log(`🔄 Testing batched processing...`);
    
    // Create multiple test tokens (using the same token multiple times for demo)
    const testTokens = [
      this.testToken,
      this.testToken,
      this.testToken,
      this.testToken,
      this.testToken,
      this.testToken,
      this.testToken,
      this.testToken
    ];
    
    console.log(`   Testing with ${testTokens.length} tokens...`);
    
    // Add all tokens to queue
    for (const tokenAddress of testTokens) {
      this.priceUpdateQueue.push(tokenAddress);
    }
    
    // Process the queue
    const startTime = Date.now();
    await this.processPriceQueue();
    const endTime = Date.now();
    
    console.log(`   ✅ Processed ${testTokens.length} tokens in ${endTime - startTime}ms`);
  }

  async testContinuousMonitoring() {
    console.log(`🔄 Testing continuous monitoring simulation...`);
    
    // Simulate monitoring for 10 seconds
    const monitoringDuration = 10000; // 10 seconds
    const startTime = Date.now();
    let updateCount = 0;
    
    console.log(`   Monitoring for ${monitoringDuration/1000} seconds...`);
    
    const monitoringInterval = setInterval(async () => {
      updateCount++;
      console.log(`   Update #${updateCount}:`);
      
      // Add token to queue
      this.priceUpdateQueue.push(this.testToken);
      
      // Process queue if not already processing
      if (!this.isProcessingQueue) {
        await this.processPriceQueue();
      }
      
      // Check if we should stop
      if (Date.now() - startTime >= monitoringDuration) {
        clearInterval(monitoringInterval);
        console.log(`   ✅ Monitoring completed. Total updates: ${updateCount}`);
      }
    }, 1000); // Update every 1 second
    
    // Wait for monitoring to complete
    await new Promise(resolve => setTimeout(resolve, monitoringDuration + 1000));
  }

  async processPriceQueue() {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;
    
    while (this.priceUpdateQueue.length > 0) {
      const batch = this.priceUpdateQueue.splice(0, this.maxConcurrentRequests);
      
      // Process batch concurrently
      const promises = batch.map(tokenAddress => this.checkTokenPriceWithCache(tokenAddress));
      await Promise.allSettled(promises);
      
      // Delay between batches to respect rate limits
      if (this.priceUpdateQueue.length > 0) {
        await new Promise(resolve => setTimeout(resolve, this.requestDelay));
      }
    }
    
    this.isProcessingQueue = false;
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
    const result = await this.getFourMemeExactPrice(tokenAddress);
    if (result && result.success) {
      // Store with timestamp for cache management
      this.tokenPriceCache.set(tokenAddress, {
        ...result.data,
        timestamp: now
      });
      console.log(`   💰 ${tokenAddress} (fresh): $${result.data.priceUSD.toFixed(8)}`);
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
        }
      } catch (error) {
        // Token might not exist or be too new
      }

      // Use token info lastPrice as the primary price source (most accurate)
      if (tokenInfo && tokenInfo.lastPrice > 0) {
        const realPrice = Number(tokenInfo.lastPrice) / 1e18;
        const bnbPriceUSD = await this.getCachedBNBPrice();
        const priceUSD = realPrice * bnbPriceUSD;
        return { success: true, data: { buyPrice: realPrice, sellPrice: realPrice, avgPrice: realPrice, priceUSD } };
      }

      // Skip simulations for rate limiting - use lastPrice only
      return { success: false, error: 'Token may be too new or not have liquidity yet' };

    } catch (error) {
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
      const newPrice = await this.getRealBNBPrice();
      this.cachedBNBPrice = newPrice;
      this.lastBNBPriceUpdate = now;
      return newPrice;
    } catch (error) {
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
      return 1000; // Fallback BNB price
    }
  }
}

// Start the tester
const tester = new ComprehensiveTester();
tester.start().catch(console.error);


