const express = require("express");
const router = express.Router();
const registerParamValidation = require("../middleware/validateRouteParams");
registerParamValidation(router);
const { Asset } = require("@stellar/stellar-sdk");
const { server } = require("../config/stellar");
const { success } = require("../utils/response");
const { validateAssetCode, validateAccountId, validateAsset } = require("../utils/validators");
const { parseStellarAsset } = require("../utils/asset");
const cacheService = require("../services/cache");
const cacheTTL = require("../config/cacheConfig");

/**
 * GET /dex/arbitrage/:assetCode/:assetIssuer
 * Checks for circular paths back to the same asset to find arbitrage opportunities.
 *
 * @example
 * GET /dex/arbitrage/USDC/GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN
 */
router.get("/arbitrage/:assetCode/:assetIssuer", async (req, res, next) => {
  try {
    const { assetCode, assetIssuer } = req.params;

    // Validate asset code and issuer (if not native)
    if (assetCode.toUpperCase() !== "XLM" || assetIssuer.toLowerCase() !== "native") {
      // Validate inputs using shared validators
      validateAsset(assetCode, assetIssuer);
    }

    const asset = (assetCode.toUpperCase() === "XLM" && assetIssuer.toLowerCase() === "native")
      ? Asset.native()
      : new Asset(assetCode.toUpperCase(), assetIssuer);

    const destinationAmount = "10.0000000";

    const pathsResponse = await server
      .strictReceivePaths([asset], asset, destinationAmount)
      .call();

    const paths = (pathsResponse.records || [])
      .map((path) => ({
        sourceAmount: path.source_amount,
        destinationAmount: path.destination_amount,
        path: path.path.map((hop) => ({
          assetCode: hop.asset_code || "XLM",
          assetIssuer: hop.asset_issuer || "native",
          assetType: hop.asset_type,
        })),
        isProfitable: parseFloat(path.source_amount) < parseFloat(path.destination_amount),
      }))
      .filter((p) => p.path.length > 0);

    return success(res, {
      pathsFound: paths.length > 0,
      paths: paths,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /dex/spread/:sellAsset/:buyAsset
 * Calculates the bid-ask spread for a trading pair on the Stellar DEX.
 *
 * @example
 * GET /dex/spread/XLM:native/USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN
 */
router.get("/spread/:sellAsset/:buyAsset", async (req, res, next) => {
  try {
    const { sellAsset, buyAsset } = req.params;

    let selling, buying;
    try {
      selling = parseStellarAsset(sellAsset);
      buying = parseStellarAsset(buyAsset);
    } catch (err) {
      return res.status(400).json({
        success: false,
        error: {
          type: "ValidationError",
          message: err.message,
        },
      });
    }

    const orderBookResponse = await server
      .orderbook(selling, buying)
      .limit(200)
      .call();

    const bids = orderBookResponse.bids || [];
    const asks = orderBookResponse.asks || [];

    if (bids.length === 0 && asks.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          type: "NotFound",
          message: "No order book exists for this trading pair.",
        },
      });
    }

    const bestBid = bids.length > 0 ? {
      price: parseFloat(bids[0].price),
      amount: parseFloat(bids[0].amount),
    } : null;

    const bestAsk = asks.length > 0 ? {
      price: parseFloat(asks[0].price),
      amount: parseFloat(asks[0].amount),
    } : null;

    let spreadAbsolute = null;
    let spreadPercent = null;
    let midPrice = null;

    if (bestBid && bestAsk) {
      spreadAbsolute = bestAsk.price - bestBid.price;
      midPrice = (bestBid.price + bestAsk.price) / 2;
      spreadPercent = (spreadAbsolute / midPrice) * 100;
    } else if (bestBid) {
      midPrice = bestBid.price;
    } else if (bestAsk) {
      midPrice = bestAsk.price;
    }

    const totalBidVolume = bids.reduce((sum, bid) => sum + parseFloat(bid.amount), 0);
    const totalAskVolume = asks.reduce((sum, ask) => sum + parseFloat(ask.amount), 0);
    const totalVolume = totalBidVolume + totalAskVolume;

    let liquidity;
    if (totalVolume >= 10000) {
      liquidity = "high";
    } else if (totalVolume >= 1000) {
      liquidity = "medium";
    } else {
      liquidity = "low";
    }

    return success(res, {
      bestBid: bestBid ? {
        price: bestBid.price.toFixed(7),
        amount: bestBid.amount.toFixed(7),
      } : null,
      bestAsk: bestAsk ? {
        price: bestAsk.price.toFixed(7),
        amount: bestAsk.amount.toFixed(7),
      } : null,
      spreadAbsolute: spreadAbsolute !== null ? spreadAbsolute.toFixed(7) : null,
      spreadPercent: spreadPercent !== null ? spreadPercent.toFixed(4) : null,
      midPrice: midPrice !== null ? midPrice.toFixed(7) : null,
      liquidity,
      orderBookDepth: {
        bids: bids.length,
        asks: asks.length,
        totalBidVolume: totalBidVolume.toFixed(7),
        totalAskVolume: totalAskVolume.toFixed(7),
        totalVolume: totalVolume.toFixed(7),
      },
    });
  } catch (err) {
    if (err.response && err.response.status === 404) {
      return res.status(404).json({
        success: false,
        error: {
          type: "NotFound",
          message: "No order book exists for this trading pair.",
        },
      });
    }
    next(err);
  }
});

/**
 * GET /dex/imbalance/:sellAsset/:buyAsset
 * Detects significant imbalances between buy and sell pressure on a Stellar DEX trading pair.
 *
 * @example
 * GET /dex/imbalance/XLM:native/USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN
 */
router.get("/imbalance/:sellAsset/:buyAsset", async (req, res, next) => {
  try {
    const { sellAsset, buyAsset } = req.params;

    let selling, buying;
    try {
      selling = parseStellarAsset(sellAsset);
      buying = parseStellarAsset(buyAsset);
    } catch (err) {
      return res.status(400).json({
        success: false,
        error: {
          type: "ValidationError",
          message: err.message,
        },
      });
    }

    const orderBook = await server.orderbook(selling, buying).limit(200).call();

    const bidVolume = (orderBook.bids || []).reduce((sum, b) => sum + parseFloat(b.amount), 0);
    const askVolume = (orderBook.asks || []).reduce((sum, a) => sum + parseFloat(a.amount), 0);

    if (bidVolume === 0 && askVolume === 0) {
      return res.status(404).json({
        success: false,
        error: {
          type: "NotFound",
          message: "No order book exists for this trading pair.",
        },
      });
    }

    const imbalanceRatio = askVolume > 0 ? bidVolume / askVolume : (bidVolume > 0 ? 100 : 1);
    
    let pressure = "neutral";
    let signal = "The market is currently balanced between buyers and sellers.";

    if (imbalanceRatio > 1.25) {
      pressure = "buy";
      signal = "Strong buy pressure detected. Demand significantly outweighs supply.";
    } else if (imbalanceRatio < 0.75) {
      pressure = "sell";
      signal = "Strong sell pressure detected. Supply significantly outweighs demand.";
    }

    return success(res, {
      bidVolume: bidVolume.toFixed(7),
      askVolume: askVolume.toFixed(7),
      imbalanceRatio: imbalanceRatio.toFixed(4),
      pressure,
      signal,
    });
  } catch (err) {
    if (err.response && err.response.status === 404) {
      return res.status(404).json({
        success: false,
        error: {
          type: "NotFound",
          message: "No order book exists for this trading pair.",
        },
      });
    }
    next(err);
  }
});

/**
 * GET /dex/depth/:sellAsset/:buyAsset
 * Analyzes the full depth of a Stellar DEX order book for a trading pair.
 *
 * Returns a summary of bids and asks, total volumes, top 5 of each,
 * and a depth rating:
 * - "deep": total volume >= 50,000
 * - "moderate": total volume >= 5,000
 * - "shallow": total volume < 5,000
 *
 * Asset format: CODE:ISSUER or XLM:native
 *
 * @example
 * GET /dex/depth/XLM:native/USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN
 */
router.get("/depth/:sellAsset/:buyAsset", async (req, res, next) => {
  try {
    const { sellAsset, buyAsset } = req.params;

    const parseStellarAsset = (assetString) => {
      const parts = assetString.split(":");
      if (parts.length !== 2) {
        throw new Error(`Invalid asset format: "${assetString}". Expected format: CODE:ISSUER`);
      }

      const [code, issuer] = parts;

      if (code.toUpperCase() === "XLM" && issuer.toLowerCase() === "native") {
        return Asset.native();
      }

      validateAssetCode(code);
      validateAccountId(issuer);

      return new Asset(code.toUpperCase(), issuer);
    };

    let selling, buying;
    try {
      selling = parseStellarAsset(sellAsset);
      buying = parseStellarAsset(buyAsset);
    } catch (err) {
      return res.status(400).json({
        success: false,
        error: {
          type: "ValidationError",
          message: err.message,
        },
      });
    }

    const orderBookResponse = await server
      .orderbook(selling, buying)
      .limit(200)
      .call();

    const bids = orderBookResponse.bids || [];
    const asks = orderBookResponse.asks || [];

    if (bids.length === 0 && asks.length === 0) {
      return res.status(404).json({
        success: false,
        error: {
          type: "NotFound",
          message: "No order book exists for this trading pair.",
        },
      });
    }

    const totalBidVolume = bids.reduce((sum, bid) => sum + parseFloat(bid.amount), 0);
    const totalAskVolume = asks.reduce((sum, ask) => sum + parseFloat(ask.amount), 0);
    const totalVolume = totalBidVolume + totalAskVolume;

    let depthRating;
    if (totalVolume >= 50000) {
      depthRating = "deep";
    } else if (totalVolume >= 5000) {
      depthRating = "moderate";
    } else {
      depthRating = "shallow";
    }

    const formatOrder = (order) => ({
      price: order.price,
      amount: order.amount,
    });

    return success(res, {
      bidsCount: bids.length,
      asksCount: asks.length,
      totalBidVolume: totalBidVolume.toFixed(7),
      totalAskVolume: totalAskVolume.toFixed(7),
      top5Bids: bids.slice(0, 5).map(formatOrder),
      top5Asks: asks.slice(0, 5).map(formatOrder),
      depthRating,
    });
  } catch (err) {
    if (err.response && err.response.status === 404) {
      return res.status(404).json({
        success: false,
        error: {
          type: "NotFound",
          message: "No order book exists for this trading pair.",
        },
      });
    }
    next(err);
  }
});

/**
 * GET /dex/price/:sellAsset/:buyAsset?amount=:amount
 * Calculates the effective exchange rate between two assets using the best
 * available payment path on the Stellar DEX.
 *
 * Asset format: CODE:ISSUER or XLM:native
 * amount query param: amount of sellAsset to convert (default: 1)
 *
 * @example
 * GET /dex/price/XLM:native/USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN?amount=100
 */
router.get("/price/:sellAsset/:buyAsset", async (req, res, next) => {
  try {
    const { sellAsset, buyAsset } = req.params;
    const amount = req.query.amount || "1";

    const parseStellarAsset = (assetString) => {
      const parts = assetString.split(":");
      if (parts.length !== 2) {
        throw new Error(`Invalid asset format: "${assetString}". Expected format: CODE:ISSUER`);
      }
      const [code, issuer] = parts;
      if (code.toUpperCase() === "XLM" && issuer.toLowerCase() === "native") {
        return Asset.native();
      }
      validateAssetCode(code);
      validateAccountId(issuer);
      return new Asset(code.toUpperCase(), issuer);
    };

    // Validate amount
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({
        success: false,
        error: { type: "ValidationError", message: "amount must be a positive number." },
      });
    }

    let selling, buying;
    try {
      selling = parseStellarAsset(sellAsset);
      buying = parseStellarAsset(buyAsset);
    } catch (err) {
      return res.status(400).json({
        success: false,
        error: { type: "ValidationError", message: err.message },
      });
    }

    // Use strictSendPaths: given a fixed source amount, find the best destination amount
    const formattedAmount = parsedAmount.toFixed(7);
    const pathsResponse = await server
      .strictSendPaths(selling, formattedAmount, [buying])
      .call();

    const records = pathsResponse.records || [];

    if (records.length === 0) {
      return res.status(404).json({
        success: false,
        error: { type: "NotFound", message: "No payment path exists between these two assets." },
      });
    }

    // Best path = highest destination amount
    const best = records.reduce((a, b) =>
      parseFloat(a.destination_amount) >= parseFloat(b.destination_amount) ? a : b
    );

    const sellAmount = parseFloat(best.source_amount);
    const buyAmount = parseFloat(best.destination_amount);
    const effectiveRate = buyAmount / sellAmount;

    const bestPath = best.path.map((hop) => ({
      assetCode: hop.asset_code || "XLM",
      assetIssuer: hop.asset_issuer || "native",
    }));

    return success(res, {
      sellAsset,
      buyAsset,
      sellAmount: sellAmount.toFixed(7),
      buyAmount: buyAmount.toFixed(7),
      effectiveRate: effectiveRate.toFixed(7),
      bestPath,
    });
  } catch (err) {
    if (err.response && err.response.status === 404) {
      return res.status(404).json({
        success: false,
        error: { type: "NotFound", message: "No payment path exists between these two assets." },
      });
    }
    next(err);
  }
});

/**
 * Converts a Horizon asset record (from a trade) into the standard
 * { code, issuer, type } shape used across this API.
 *
 * @param {string} type   - asset_type field from Horizon (e.g. "native", "credit_alphanum4")
 * @param {string} code   - asset_code field (undefined for native XLM)
 * @param {string} issuer - asset_issuer field (undefined for native XLM)
 * @returns {{ code: string, issuer: string|null, type: string }}
 */
function formatAsset(type, code, issuer) {
  if (type === "native") {
    return { code: "XLM", issuer: null, type: "native" };
  }
  return {
    code: code || "",
    issuer: issuer || null,
    type: type || "credit_alphanum4",
  };
}

/**
 * Builds a stable string key for a trading pair regardless of direction.
 * Alphabetical ordering ensures XLM/USDC and USDC/XLM map to the same key.
 */
function pairKey(baseType, baseCode, baseIssuer, counterType, counterCode, counterIssuer) {
  const a = baseType === "native" ? "XLM:native" : `${baseCode}:${baseIssuer}`;
  const b = counterType === "native" ? "XLM:native" : `${counterCode}:${counterIssuer}`;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * GET /dex/top-markets?limit=10
 * Returns the top Stellar DEX trading pairs ranked by 24-hour base-asset volume.
 *
 * Query params:
 *   - limit  (number, 1–50, default: 10)
 *
 * Response shape:
 *   { success: true, data: { markets: [...], total } }
 *
 * Each market entry:
 *   {
 *     baseAsset:     { code, issuer, type },
 *     counterAsset:  { code, issuer, type },
 *     baseVolume:    "1234567.0000000",
 *     counterVolume: "1234567.0000000",
 *     tradeCount:    42,
 *     spread:        "0.0012345" | null   // null when no live order book
 *   }
 *
 * Strategy:
 *   Horizon has no single "top markets by volume" endpoint. We fetch the most
 *   recent 200 trades (the practical maximum for a single page), aggregate
 *   volume client-side per pair, rank by baseVolume descending, then enrich
 *   the top-N results with a live order book call to compute the bid-ask spread.
 *
 * @example
 * GET /dex/top-markets?limit=5
 */
router.get("/top-markets", async (req, res, next) => {
  try {
    // ── 1. Validate limit ────────────────────────────────────────────────────
    const MAX_LIMIT = 50;
    const DEFAULT_LIMIT = 10;
    const rawLimit = req.query.limit;

    let limit = DEFAULT_LIMIT;
    if (rawLimit !== undefined) {
      const parsed = parseInt(rawLimit, 10);
      if (isNaN(parsed) || parsed < 1) {
        return res.status(400).json({
          success: false,
          error: {
            type: "ValidationError",
            message: "limit must be a positive integer between 1 and 50.",
          },
        });
      }
      limit = Math.min(parsed, MAX_LIMIT);
    }

    // ── 2. Cache check ───────────────────────────────────────────────────────
    const cacheKey = `dex:top-markets:${limit}`;
    const cached = cacheService.get(cacheKey);
    if (cached) {
      res.set("X-Cache", "HIT");
      return success(res, cached);
    }
    res.set("X-Cache", "MISS");

    // ── 3. Fetch recent trades from Horizon ──────────────────────────────────
    // Horizon's /trades endpoint returns the most recent trades across all
    // pairs. We request 200 records (the Horizon max per page) to give the
    // aggregation enough data to surface the busiest pairs.
    const tradesResponse = await server
      .trades()
      .order("desc")
      .limit(200)
      .call();

    const trades = tradesResponse.records || [];

    // ── 4. Aggregate volume per pair ─────────────────────────────────────────
    const pairMap = new Map();

    for (const trade of trades) {
      const key = pairKey(
        trade.base_asset_type,
        trade.base_asset_code,
        trade.base_asset_issuer,
        trade.counter_asset_type,
        trade.counter_asset_code,
        trade.counter_asset_issuer,
      );

      if (!pairMap.has(key)) {
        pairMap.set(key, {
          baseAsset: formatAsset(
            trade.base_asset_type,
            trade.base_asset_code,
            trade.base_asset_issuer,
          ),
          counterAsset: formatAsset(
            trade.counter_asset_type,
            trade.counter_asset_code,
            trade.counter_asset_issuer,
          ),
          baseVolume: 0,
          counterVolume: 0,
          tradeCount: 0,
        });
      }

      const entry = pairMap.get(key);
      entry.baseVolume += parseFloat(trade.base_amount || "0");
      entry.counterVolume += parseFloat(trade.counter_amount || "0");
      entry.tradeCount += 1;
    }

    // ── 5. Rank by baseVolume descending, take top `limit` ──────────────────
    const ranked = Array.from(pairMap.values())
      .sort((a, b) => b.baseVolume - a.baseVolume)
      .slice(0, limit);

    // ── 6. Enrich with live spread (parallel order book calls) ───────────────
    const withSpread = await Promise.all(
      ranked.map(async (market) => {
        let spread = null;
        try {
          const selling =
            market.baseAsset.type === "native"
              ? Asset.native()
              : new Asset(market.baseAsset.code, market.baseAsset.issuer);

          const buying =
            market.counterAsset.type === "native"
              ? Asset.native()
              : new Asset(market.counterAsset.code, market.counterAsset.issuer);

          const ob = await server.orderbook(selling, buying).limit(1).call();
          const bestBid = ob.bids && ob.bids.length > 0 ? parseFloat(ob.bids[0].price) : null;
          const bestAsk = ob.asks && ob.asks.length > 0 ? parseFloat(ob.asks[0].price) : null;

          if (bestBid !== null && bestAsk !== null) {
            spread = (bestAsk - bestBid).toFixed(7);
          }
        } catch (_) {
          // Order book unavailable for this pair — spread stays null
        }

        return {
          baseAsset: market.baseAsset,
          counterAsset: market.counterAsset,
          baseVolume: market.baseVolume.toFixed(7),
          counterVolume: market.counterVolume.toFixed(7),
          tradeCount: market.tradeCount,
          spread,
        };
      }),
    );

    // ── 7. Build response and cache ──────────────────────────────────────────
    const data = {
      markets: withSpread,
      total: withSpread.length,
    };

    cacheService.set(cacheKey, data, cacheTTL.topMarkets);

    return success(res, data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
