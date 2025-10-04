const fs = require('fs');
const path = require('path');

function loadPatterns() {
  const patternsPath = path.join(__dirname, 'patterns.json');
  let patterns = [];
  try {
    if (fs.existsSync(patternsPath)) {
      const patternsData = fs.readFileSync(patternsPath, 'utf8');
      patterns = JSON.parse(patternsData).patterns.filter(p => p.enabled);
    }
  } catch (e) {
    console.error('❌ Error loading patterns.json:', e);
  }
  return patterns;
}

function matchPattern(tokenCreation, patterns) {
  if (!patterns || patterns.length === 0) return null;
  
  // Sort patterns by priority (lower number = higher priority)
  const sortedPatterns = patterns.sort((a, b) => (a.priority || 10) - (b.priority || 10));
  
  return sortedPatterns.find(pattern => {
    // Check if pattern is enabled
    if (!pattern.enabled) return false;
    
    // Match gas price (convert to gwei if needed)
    const gasPriceGwei = tokenCreation.gasPriceGwei;
    const gasPriceMin = pattern.gasPrice.min;
    const gasPriceMax = pattern.gasPrice.max;
    
    // Match gas limit
    const gasLimit = tokenCreation.gasLimit;
    const gasLimitMin = pattern.gasLimit.min;
    const gasLimitMax = pattern.gasLimit.max;
    
    const gasPriceMatch = gasPriceGwei >= gasPriceMin && gasPriceGwei <= gasPriceMax;
    const gasLimitMatch = gasLimit >= gasLimitMin && gasLimit <= gasLimitMax;
    
    return gasPriceMatch && gasLimitMatch;
  }) || null;
}

module.exports = { loadPatterns, matchPattern };

