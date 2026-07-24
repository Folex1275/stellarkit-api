/**
 * Creates a structured AccountNotFound error for Horizon 404 responses.
 *
 * @param {string} accountId - Stellar public key that was not found
 * @param {string} network - Network name ("testnet" or "mainnet")
 * @returns {Error}
 */
function makeAccountNotFoundError(accountId, network) {
  const err = new Error(
    `Account ${accountId} was not found on the Stellar ${network} network.`
  );
  err.isAccountNotFound = true;
  err.accountId = accountId;
  err.network = network;
  err.status = 404;
  return err;
}

/**
 * Creates a structured error for insufficient XLM reserve scenarios.
 * Use this when an account does not have enough XLM to meet the minimum
 * reserve requirement (e.g., when creating a new account or adding subentries).
 *
 * @param {string} accountId - Stellar public key with insufficient reserve
 * @param {number} availableBalance - Current spendable XLM balance
 * @param {number} requiredReserve - Minimum XLM reserve required
 * @param {string} network - Network name ("testnet" or "mainnet")
 * @returns {Error}
 */
function makeInsufficientXLMReserveError(accountId, availableBalance, requiredReserve, network) {
  const shortfall = Math.max(0, requiredReserve - availableBalance);
  const err = new Error(
    `Account ${accountId} has insufficient XLM reserve on the Stellar ${network} network. ` +
    `Available: ${availableBalance} XLM, Required: ${requiredReserve} XLM, Shortfall: ${shortfall.toFixed(7)} XLM.`
  );
  err.isInsufficientXLMReserve = true;
  err.accountId = accountId;
  err.availableBalance = availableBalance;
  err.requiredReserve = requiredReserve;
  err.shortfall = shortfall;
  err.network = network;
  err.status = 422;
  return err;
}

module.exports = { makeAccountNotFoundError, makeInsufficientXLMReserveError };
