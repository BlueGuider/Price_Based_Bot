const { SimplePriceBasedTradingService } = require('./simplePriceBasedTradingService');

/**
 * Test script for Price-Based Trading Service
 * This script tests the basic functionality without starting the full trading system
 */

async function testPriceTradingService() {
  console.log('🧪 Testing Price-Based Trading Service...');
  console.log('='.repeat(50));

  try {
    // Create service instance
    const tradingService = new SimplePriceBasedTradingService();
    
    // Test configuration loading
    console.log('📊 Testing configuration...');
    const config = tradingService.getConfig();
    console.log(`   Low Threshold: $${config.trading.lowThresholdUSD}`);
    console.log(`   High Threshold: $${config.trading.highThresholdUSD}`);
    console.log(`   Migration Price: $${config.trading.migrationPriceUSD}`);
    console.log(`   Buy Amount: ${config.trading.buyAmountBNB} BNB`);
    console.log(`   Test Mode: ${config.trading.testMode ? 'ON' : 'OFF'}`);
    console.log('✅ Configuration loaded successfully');
    console.log('');

    // Test wallet loading
    console.log('💰 Testing wallet loading...');
    const stats = tradingService.getStats();
    console.log(`   Available Wallets: ${stats.availableWallets}`);
    console.log('✅ Wallet loading completed');
    console.log('');

    // Test configuration update
    console.log('📝 Testing configuration update...');
    tradingService.updateConfig({
      trading: {
        lowThresholdUSD: 0.00003,
        highThresholdUSD: 0.00009
      }
    });
    const updatedConfig = tradingService.getConfig();
    console.log(`   Updated Low Threshold: $${updatedConfig.trading.lowThresholdUSD}`);
    console.log(`   Updated High Threshold: $${updatedConfig.trading.highThresholdUSD}`);
    console.log('✅ Configuration update successful');
    console.log('');

    // Test monitored tokens
    console.log('🎯 Testing monitored tokens...');
    const monitoredTokens = tradingService.getMonitoredTokens();
    console.log(`   Currently Monitored: ${monitoredTokens.length}`);
    console.log('✅ Monitored tokens check completed');
    console.log('');

    console.log('🎉 All tests passed successfully!');
    console.log('='.repeat(50));
    console.log('');
    console.log('📋 Next Steps:');
    console.log('1. Create wallets using the wallet service');
    console.log('2. Set trading.enabled to true in price-trading-config.json');
    console.log('3. Run: node price-trading-bot.js');
    console.log('');

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the test
testPriceTradingService();
