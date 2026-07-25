const cacheService = require("../services/cache");

module.exports = {
  networkStatusCache: cacheService,
  feeEstimateCache: cacheService,
const NodeCache = require("node-cache");

function createCache() {
  return new NodeCache({ stdTTL: 60, checkperiod: 12, useClones: false });
}

module.exports = {
  networkStatusCache: createCache(),
  feeEstimateCache: createCache(),
};
