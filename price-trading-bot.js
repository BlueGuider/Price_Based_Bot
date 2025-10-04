const { SimplePriceBasedTradingService } = require('./simplePriceBasedTradingService');
const fs = require('fs');
const path = require('path');

/**
 * Price-Based Trading Bot
 * 
 * This script runs the new price-based trading system that:
 * 1. Monitors ALL newly created tokens on four.meme
 * 2. Buys tokens when price exceeds low threshold
 * 3. Sells tokens when price exceeds high threshold
 * 4. Automatically manages monitoring list (adds new tokens, removes inactive ones)
 */

class PriceTradingBot {
  constructor() {
    this.tradingService = new SimplePriceBasedTradingService();
    this.isRunning = false;
    this.startTime = new Date();
    this.lastStatusTime = this.startTime.getTime();
    this.statusInterval = null;
  }

  /**
   * Start the price-based trading bot
   */
  async start() {
    if (this.isRunning) {
      console.log('⚠️ Price trading bot is already running');
      return;
    }

    try {
      console.log('🚀 Starting Price-Based Trading Bot...');
      console.log('='.repeat(60));
      
      // Display configuration
      this.displayConfiguration();
      
      // Start trading
      await this.tradingService.startTrading();
      
      this.isRunning = true;
      this.startStatusUpdates();
      
      console.log('✅ Price-based trading bot started successfully');
      console.log('Press Ctrl+C to stop');
      console.log('='.repeat(60));

    } catch (error) {
      console.error('❌ Error starting price trading bot:', error);
      process.exit(1);
    }
  }

  /**
   * Stop the price-based trading bot
   */
  async stop() {
    if (!this.isRunning) {
      console.log('⚠️ Price trading bot is not running');
      return;
    }

    try {
      console.log('\n🛑 Stopping price-based trading bot...');
      
      if (this.statusInterval) {
        clearInterval(this.statusInterval);
        this.statusInterval = null;
      }
      
      await this.tradingService.stopTrading();
      
      this.isRunning = false;
      
      // Display final statistics
      this.displayFinalStats();
      
      console.log('✅ Price-based trading bot stopped');
      process.exit(0);

    } catch (error) {
      console.error('❌ Error stopping price trading bot:', error);
      process.exit(1);
    }
  }

  /**
   * Display current configuration
   */
  displayConfiguration() {
    const config = this.tradingService.getConfig();
    const monitoredTokens = this.tradingService.getMonitoredTokens();
    
    console.log('📊 Current Configuration:');
    console.log(`   Trading Enabled: ${config.trading.enabled ? 'YES' : 'NO'}`);
    console.log(`   Test Mode: ${config.trading.testMode ? 'ON' : 'OFF'}`);
    console.log(`   Re-entry Enabled: ${config.trading.reentryEnabled ? 'YES' : 'NO'}`);
    console.log(`   Max Trades Per Token: ${config.trading.maxTradesPerCycle ?? 2}`);
    console.log(`   Update Interval: ${config.monitoring.updateIntervalMs}ms`);
    console.log(`   Inactive Timeout: ${config.monitoring.inactiveTimeoutMinutes} minutes`);
    console.log(`   Max Concurrent Tokens: ${config.monitoring.maxConcurrentTokens}`);
    console.log(`   Max Trades/Hour: ${config.safety.maxTradesPerHour}`);
    console.log(`   Max Trades/Day: ${config.safety.maxTradesPerDay}`);
    console.log('');
    
    // Show pattern usage statistics
    const patternStats = {};
    monitoredTokens.forEach(token => {
      if (token.matchedPattern) {
        const patternName = token.matchedPattern.name;
        if (!patternStats[patternName]) {
          patternStats[patternName] = { total: 0, traded: 0, active: 0 };
        }
        patternStats[patternName].total++;
        if (token.hasBeenTraded) patternStats[patternName].traded++;
        if (token.isActive) patternStats[patternName].active++;
      }
    });
    
    if (Object.keys(patternStats).length > 0) {
      console.log('🎯 Pattern Usage Statistics:');
      Object.entries(patternStats).forEach(([patternName, stats]) => {
        console.log(`   ${patternName}: ${stats.active} active, ${stats.traded} traded, ${stats.total} total`);
      });
      console.log('');
    }
  }

  /**
   * Start status updates
   */
  startStatusUpdates() {
    this.statusInterval = setInterval(() => {
      this.displayStatus();
    }, 30000); // Update every 30 seconds
  }

  /**
   * Display current status
   */
  displayStatus() {
    const stats = this.tradingService.getStats();
    const monitoredTokens = this.tradingService.getMonitoredTokens();
    const uptime = Math.floor((Date.now() - this.startTime.getTime()) / 1000);
    
    console.log('\n📈 Trading Status Update:');
    console.log(`   Uptime: ${this.formatUptime(uptime)}`);
    console.log(`   Tokens Monitored: ${stats.tokensCurrentlyMonitored}`);
    console.log(`   Total Trades: ${stats.totalTrades}`);
    console.log(`   Successful Buys: ${stats.successfulBuys}`);
    console.log(`   Successful Sells: ${stats.successfulSells}`);
    console.log(`   Total Profit: $${stats.totalProfitUSD.toFixed(8)}`);
    console.log(`   Available Wallets: ${stats.availableWallets}`);
    
    // Show recent token activity
    if (monitoredTokens.length > 0) {
      console.log(`\n🎯 Recent Token Activity (${monitoredTokens.length} total):`);
      const recentTokens = monitoredTokens
        .filter(token => token.isActive)
        .sort((a, b) => b.lastPriceUpdate.getTime() - a.lastPriceUpdate.getTime())
        .slice(0, 10); // Show up to 10 tokens instead of 5
      
      recentTokens.forEach(token => {
        const priceChangeEmoji = token.priceChangePercent > 0 ? '📈' : 
                                token.priceChangePercent < 0 ? '📉' : '➡️';
        const tradedStatus = token.hasBeenTraded ? '✅' : '⏳';
        const patternName = token.matchedPattern ? token.matchedPattern.name : 'Unknown';
        const positionStatus = token.positionOpen ? '🟢' : '⚪';
        console.log(`   ${tradedStatus} ${positionStatus} ${token.tokenAddress.slice(0, 8)}... $${token.currentPriceUSD.toFixed(8)} ${priceChangeEmoji} ${token.priceChangePercent > 0 ? '+' : ''}${token.priceChangePercent.toFixed(2)}% (${patternName})`);
      });
    }
    
    console.log('');
  }

  /**
   * Display final statistics
   */
  displayFinalStats() {
    const stats = this.tradingService.getStats();
    const uptime = Math.floor((Date.now() - this.startTime.getTime()) / 1000);
    
    console.log('\n📊 Final Trading Statistics:');
    console.log('='.repeat(40));
    console.log(`Total Runtime: ${this.formatUptime(uptime)}`);
    console.log(`Tokens Monitored: ${stats.tokensMonitored}`);
    console.log(`Tokens Traded: ${stats.tokensTraded}`);
    console.log(`Total Trades: ${stats.totalTrades}`);
    console.log(`Successful Buys: ${stats.successfulBuys}`);
    console.log(`Successful Sells: ${stats.successfulSells}`);
    console.log(`Total Profit: $${stats.totalProfitUSD.toFixed(8)}`);
    console.log(`Success Rate: ${stats.totalTrades > 0 ? ((stats.successfulBuys + stats.successfulSells) / stats.totalTrades * 100).toFixed(1) : 0}%`);
    console.log('='.repeat(40));
  }

  /**
   * Format uptime in human readable format
   */
  formatUptime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  }

  /**
   * Handle configuration updates
   */
  async updateConfig(updates) {
    try {
      this.tradingService.updateConfig(updates);
      console.log('✅ Configuration updated successfully');
      this.displayConfiguration();
    } catch (error) {
      console.error('❌ Error updating configuration:', error);
    }
  }

  /**
   * Get current statistics
   */
  getStats() {
    return this.tradingService.getStats();
  }

  /**
   * Get monitored tokens
   */
  getMonitoredTokens() {
    return this.tradingService.getMonitoredTokens();
  }
}

// Create and start the bot
const bot = new PriceTradingBot();

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Received shutdown signal...');
  await bot.stop();
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Received termination signal...');
  await bot.stop();
});

// Handle uncaught exceptions
process.on('uncaughtException', async (error) => {
  console.error('❌ Uncaught Exception:', error);
  await bot.stop();
});

process.on('unhandledRejection', async (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  await bot.stop();
});

// Start the bot
bot.start().catch(error => {
  console.error('❌ Failed to start bot:', error);
  process.exit(1);
});

// Export for potential external use
module.exports = PriceTradingBot;
