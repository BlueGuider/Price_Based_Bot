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
  return patterns.find(pattern => {
    return (
      tokenCreation.gasPriceGwei >= pattern.gasPrice.min &&
      tokenCreation.gasPriceGwei <= pattern.gasPrice.max &&
      tokenCreation.gasLimit >= pattern.gasLimit.min &&
      tokenCreation.gasLimit <= pattern.gasLimit.max
    );
  }) || null;
}

module.exports = { loadPatterns, matchPattern };

