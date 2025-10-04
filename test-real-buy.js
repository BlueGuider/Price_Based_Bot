const { SimplePriceBasedTradingService } = require('./simplePriceBasedTradingService');

async function testRealBuy() {
  const service = new SimplePriceBasedTradingService();
  
  console.log('🔍 Testing REAL BUY transaction...');
  console.log('Token:', '0xb05157e398650432c311f8905d701ed505354444');
  console.log('Amount:', '0.0001 BNB');
  
  try {
    // Load wallets and config
    await service.loadAvailableWallets();
    const config = service.getConfig();
    
    console.log('\n📊 Current Configuration:');
    console.log('Test Mode:', config.trading.testMode);
    console.log('Trading Enabled:', config.trading.enabled);
    console.log('Buy Amount:', config.trading.buyAmountBNB, 'BNB');
    
    console.log('\n💰 Available Wallets:');
    service.availableWallets.forEach((wallet, index) => {
      console.log(`${index + 1}. ${wallet.address} - ${wallet.balanceBNB} BNB`);
    });
    
    // Check if we have funded wallets
    const fundedWallets = service.availableWallets.filter(w => w.balanceBNB >= 0.0001);
    if (fundedWallets.length === 0) {
      console.log('\n❌ No funded wallets available for testing');
      return;
    }
    
    console.log(`\n✅ Found ${fundedWallets.length} funded wallet(s)`);
    
    // Create a mock token object for testing
    const testToken = {
      tokenAddress: '0xb05157e398650432c311f8905d701ed505354444',
      currentPriceUSD: 0,
      priceChangePercent: 0,
      lastPriceUpdate: new Date(),
      isActive: true,
      hasBeenTraded: false
    };
    
    console.log('\n🔍 Testing token info...');
    const tokenInfo = await service.getTokenInfo(testToken.tokenAddress);
    
    if (tokenInfo.success) {
      console.log('✅ Token info fetched:');
      console.log('   Version:', tokenInfo.data.version.toString());
      console.log('   Token Manager:', tokenInfo.data.tokenManager);
      console.log('   Quote Token:', tokenInfo.data.quote);
      console.log('   Last Price:', tokenInfo.data.lastPrice.toString());
      console.log('   Liquidity Added:', tokenInfo.data.liquidityAdded);
    } else {
      console.log('❌ Token info failed:', tokenInfo.error);
      return;
    }
    
    console.log('\n🔍 Testing buy parameters...');
    const buyParams = await service.getBuyParams(testToken.tokenAddress, 0.0001);
    
    if (buyParams.success) {
      console.log('✅ Buy parameters fetched:');
      console.log('   Token Manager:', buyParams.data.tokenManager);
      console.log('   Amount Funds:', buyParams.data.amountFunds.toString());
      console.log('   Amount Msg Value:', buyParams.data.amountMsgValue.toString());
    } else {
      console.log('❌ Buy parameters failed:', buyParams.error);
      return;
    }
    
    console.log('\n🔍 Testing migration check...');
    const isMigrated = await service.isTokenMigrated(testToken.tokenAddress);
    console.log('Migration status:', isMigrated ? 'MIGRATED' : 'NOT MIGRATED');
    
    if (isMigrated) {
      console.log('❌ Token is migrated to PancakeSwap - cannot buy on four.meme');
      return;
    }
    
    console.log('\n🚀 Executing REAL BUY transaction...');
    console.log('⚠️  This will spend real BNB!');
    
    // Execute the real buy
    const buyResult = await service.executeRealBuy(testToken);
    
    if (buyResult.success) {
      console.log('\n✅ BUY TRANSACTION SUCCESSFUL!');
      console.log('Transaction Hash:', buyResult.transactionHash);
    } else {
      console.log('\n❌ BUY TRANSACTION FAILED!');
      console.log('Error:', buyResult.error);
    }
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error('Stack:', error.stack);
  }
}

// Run the test
testRealBuy().then(() => {
  console.log('\n🏁 Test completed');
  process.exit(0);
}).catch(error => {
  console.error('💥 Test crashed:', error);
  process.exit(1);
});


