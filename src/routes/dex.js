const express = require("express");
const router = express.Router();
const registerParamValidation = require("../middleware/validateRouteParams");
registerParamValidation(router);
const { Asset } = require("@stellar/stellar-sdk");
const { server } = require("../config/stellar");
const { success } = require("../utils/response");
const { validateAssetCode, validateAccountId, validateAsset, validateLimit } = require("../utils/validators");
const { parseStellarAsset } = require("../utils/asset");
const { makeOrderBookEmptyError } = require("../utils/errors");
const cacheService = require("../services/cache");

/**
 * @route GET /dex/arbitrage/:assetCode/:assetIssuer
 * @desc Finds circular strict-receive paths that start and end in the same asset and flags potentially profitable loops.
 * @param {import("express").Request} req - Express request object.
 * @param {string} req.params.assetCode - Asset code to evaluate (for example `FUSD`, `XLM`).
 * @param {string} req.params.assetIssuer - Issuer public key for credit assets, or `native` when `assetCode` is `XLM`.
 * @param {import("express").Response} res - Express response object.
 * @param {import("express").NextFunction} next - Express next middleware function.
 * @returns {Promise<void>} JSON payload containing `pathsFound` and a normalized list of arbitrage path candidates.
 * @example
 * curl -s "http://localhost:3000/dex/arbitrage/FUSD/GBFUSDFICTIONALISSUERKEY000000000000000000000000000000" | jq
 * // {
 * //   "success": true,
 * //   "data": {
 * //     "pathsFound": true,
 * //     "paths": [
 * //       {
 * //         "sourceAmount": "9.9200000",
 * //         "destinationAmount": "10.0000000",
 * //         "path": [
 * //           { "assetCode": "NOVA", "assetIssuer": "GBNOVAISSUERFICTIONALKEY0000000000000000000000000000", "assetType": "credit_alphanum4" },
 * //           { "assetCode": "XLM", "assetIssuer": "native", "assetType": "native" }
 * //         ],
 * //         "isProfitable": true
 * //       }
 * //     ]
 * //   }
 * // }
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
 * @route GET /dex/spread/:sellAsset/:buyAsset
 * @desc Computes best bid/ask, spread metrics, liquidity band, and depth totals for a Stellar DEX trading pair.
 * @param {import("express").Request} req - Express request object.
 * @param {string} req.params.sellAsset - Asset being sold in `CODE:ISSUER` format or `XLM:native`.
 * @param {string} req.params.buyAsset - Asset being bought in `CODE:ISSUER` format or `XLM:native`.
 * @param {import("express").Response} res - Express response object.
 * @param {import("express").NextFunction} next - Express next middleware function.
 * @returns {Promise<void>} JSON payload with `bestBid`, `bestAsk`, `spreadAbsolute`, `spreadPercent`, `midPrice`, and `orderBookDepth`.
 * @example
 * curl -s "http://localhost:3000/dex/spread/XLM:native/NOVA:GBNOVAISSUERFICTIONALKEY0000000000000000000000000000" | jq
 * // {
 * //   "success": true,
 * //   "data": {
 * //     "bestBid": { "price": "0.1284000", "amount": "4200.0000000" },
 * //     "bestAsk": { "price": "0.1291000", "amount": "3800.0000000" },
 * //     "spreadAbsolute": "0.0007000",
 * //     "spreadPercent": "0.5438",
 * //     "midPrice": "0.1287500",
 * //     "liquidity": "medium",
 * //     "orderBookDepth": { "bids": 37, "asks": 41, "totalVolume": "12540.0000000" }
 * //   }
 * // }
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
        error: makeOrderBookEmptyError(selling.getCode(), buying.getCode()),
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
        error: makeOrderBookEmptyError(req.params.sellAsset, req.params.buyAsset),
      });
    }
    next(err);
  }
});

/**
 * @route GET /dex/imbalance/:sellAsset/:buyAsset
 * @desc Measures buy-vs-sell pressure by comparing aggregate bid and ask volume for a market pair.
 * @param {import("express").Request} req - Express request object.
 * @param {string} req.params.sellAsset - Base/sell asset in `CODE:ISSUER` format or `XLM:native`.
 * @param {string} req.params.buyAsset - Quote/buy asset in `CODE:ISSUER` format or `XLM:native`.
 * @param {import("express").Response} res - Express response object.
 * @param {import("express").NextFunction} next - Express next middleware function.
 * @returns {Promise<void>} JSON payload with `bidVolume`, `askVolume`, `imbalanceRatio`, `pressure`, and a human-readable `signal`.
 * @example
 * curl -s "http://localhost:3000/dex/imbalance/FUSD:GBFUSDFICTIONALISSUERKEY000000000000000000000000000000/XLM:native" | jq
 * // {
 * //   "success": true,
 * //   "data": {
 * //     "bidVolume": "18500.0000000",
 * //     "askVolume": "11980.5000000",
 * //     "imbalanceRatio": "1.5442",
 * //     "pressure": "buy",
 * //     "signal": "Strong buy pressure detected. Demand significantly outweighs supply."
 * //   }
 * // }
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
        error: makeOrderBookEmptyError(selling.getCode(), buying.getCode()),
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
        error: makeOrderBookEmptyError(req.params.sellAsset, req.params.buyAsset),
      });
    }
    next(err);
  }
});

/**
 * @route GET /dex/depth/:sellAsset/:buyAsset
 * @desc Summarizes order book depth with side counts, cumulative volumes, top 5 bid/ask levels, and a depth rating.
 * @param {import("express").Request} req - Express request object.
 * @param {string} req.params.sellAsset - Asset to sell in `CODE:ISSUER` format or `XLM:native`.
 * @param {string} req.params.buyAsset - Asset to buy in `CODE:ISSUER` format or `XLM:native`.
 * @param {import("express").Response} res - Express response object.
 * @param {import("express").NextFunction} next - Express next middleware function.
 * @returns {Promise<void>} JSON payload containing `bidsCount`, `asksCount`, volume totals, top levels, and `depthRating` (`deep`, `moderate`, `shallow`).
 * @example
 * curl -s "http://localhost:3000/dex/depth/NOVA:GBNOVAISSUERFICTIONALKEY0000000000000000000000000000/FUSD:GBFUSDFICTIONALISSUERKEY000000000000000000000000000000" | jq
 * // {
 * //   "success": true,
 * //   "data": {
 * //     "bidsCount": 64,
 * //     "asksCount": 59,
 * //     "totalBidVolume": "72450.1200000",
 * //     "totalAskVolume": "69110.0000000",
 * //     "top5Bids": [{ "price": "0.9912000", "amount": "1200.0000000" }],
 * //     "top5Asks": [{ "price": "0.9948000", "amount": "980.0000000" }],
 * //     "depthRating": "deep"
 * //   }
 * // }
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
        error: makeOrderBookEmptyError(selling.getCode(), buying.getCode()),
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
        error: makeOrderBookEmptyError(req.params.sellAsset, req.params.buyAsset),
      });
    }
    next(err);
  }
});

/**
 * @route GET /dex/price/:sellAsset/:buyAsset
 * @desc Estimates effective conversion rate using strict-send pathfinding for a given sell amount.
 * @param {import("express").Request} req - Express request object.
 * @param {string} req.params.sellAsset - Source asset in `CODE:ISSUER` format or `XLM:native`.
 * @param {string} req.params.buyAsset - Destination asset in `CODE:ISSUER` format or `XLM:native`.
 * @param {string} [req.query.amount=1] - Amount of `sellAsset` to convert.
 * @param {import("express").Response} res - Express response object.
 * @param {import("express").NextFunction} next - Express next middleware function.
 * @returns {Promise<void>} JSON payload with normalized sell/buy amounts, computed `effectiveRate`, and the best hop path.
 * @example
 * curl -s "http://localhost:3000/dex/price/XLM:native/FUSD:GBFUSDFICTIONALISSUERKEY000000000000000000000000000000?amount=250" | jq
 * // {
 * //   "success": true,
 * //   "data": {
 * //     "sellAsset": "XLM:native",
 * //     "buyAsset": "FUSD:GBFUSDFICTIONALISSUERKEY000000000000000000000000000000",
 * //     "sellAmount": "250.0000000",
 * //     "buyAmount": "31.8750000",
 * //     "effectiveRate": "0.1275000",
 * //     "bestPath": [{ "assetCode": "NOVA", "assetIssuer": "GBNOVAISSUERFICTIONALKEY0000000000000000000000000000" }]
 * //   }
 * // }
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
 * Trading pairs tracked by /dex/top-markets, quoted against XLM (native).
 *
 * Configurable via DEX_TOP_MARKETS as a comma-separated "CODE:ISSUER" list, e.g.
 *   DEX_TOP_MARKETS=USDC:GA5Z...,AQUA:GA3A...
 * Asset codes are not unique on the Stellar network (anyone can issue an asset
 * under any code), so only trusted, verified issuer accounts should be listed —
 * defaults to Circle's official USDC issuer, used elsewhere in this API.
 */
function parseTopMarketsAssets() {
  const raw = process.env.DEX_TOP_MARKETS;
  if (!raw) {
    return [{ code: "USDC", issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN" }];
  }
  return raw
    .split(",")
    .map((entry) => {
      const [code, issuer] = entry.trim().split(":");
      return { code, issuer };
    })
    .filter(({ code, issuer }) => code && issuer);
}

const TOP_MARKETS_ASSETS = parseTopMarketsAssets();

const TOP_MARKETS_WINDOW_MS = 24 * 60 * 60 * 1000; // 1-day trade aggregation bucket
const TOP_MARKETS_CACHE_TTL_MS = parseInt(process.env.CACHE_TTL_TOP_MARKETS_MS, 10) || 10000;

/**
 * Normalizes a Stellar SDK Asset into the standard StellarKit asset shape.
 *
 * @param {import("@stellar/stellar-sdk").Asset} asset
 * @returns {{code: string, issuer: string|null, type: string}}
 */
function formatMarketAsset(asset) {
  return asset.isNative()
    ? { code: "XLM", issuer: null, type: "native" }
    : { code: asset.getCode(), issuer: asset.getIssuer(), type: asset.getAssetType() };
}

/**
 * GET /dex/top-markets
 * Ranks a curated set of Stellar DEX trading pairs against XLM by 24-hour base volume.
 *
 * Query params:
 *   - limit (number, default: 10, max: number of tracked markets)
 *   - fresh ("true" to bypass the cache)
 *
 * Cached for CACHE_TTL_TOP_MARKETS_MS (default 10s), keyed by limit.
 *
 * @example
 * GET /dex/top-markets
 * GET /dex/top-markets?limit=5
 */
router.get("/top-markets", async (req, res, next) => {
  try {
    const limit = Math.min(
      Math.max(parseInt(req.query.limit, 10) || 10, 1),
      TOP_MARKETS_ASSETS.length
    );
    const fresh = req.query.fresh === "true";
    const cacheKey = `dex:top-markets:${limit}`;

    if (!fresh) {
      const cached = cacheService.get(cacheKey);
      if (cached) {
        res.set("X-Cache", "HIT");
        return success(res, cached);
      }
    }

    const now = Date.now();
    const startTime = now - TOP_MARKETS_WINDOW_MS;
    const base = Asset.native();

    const markets = await Promise.all(
      TOP_MARKETS_ASSETS.map(async ({ code, issuer }) => {
        const counter = new Asset(code, issuer);
        let agg = null;
        try {
          const aggResponse = await server
            .tradeAggregation(base, counter, startTime, now, TOP_MARKETS_WINDOW_MS, 0)
            .limit(1)
            .order("desc")
            .call();
          agg = (aggResponse.records || [])[0] || null;
        } catch (err) {
          agg = null;
        }

        return {
          baseAsset: formatMarketAsset(base),
          counterAsset: formatMarketAsset(counter),
          baseVolume: parseFloat(agg ? agg.base_volume : "0").toFixed(7),
          counterVolume: parseFloat(agg ? agg.counter_volume : "0").toFixed(7),
          tradeCount: agg ? agg.trade_count : 0,
          open: agg ? parseFloat(agg.open).toFixed(7) : null,
          high: agg ? parseFloat(agg.high).toFixed(7) : null,
          low: agg ? parseFloat(agg.low).toFixed(7) : null,
          close: agg ? parseFloat(agg.close).toFixed(7) : null,
        };
      })
    );

    const items = markets
      .sort((a, b) => parseFloat(b.baseVolume) - parseFloat(a.baseVolume))
      .slice(0, limit);

    const data = { items, total: items.length };

    cacheService.set(cacheKey, data, TOP_MARKETS_CACHE_TTL_MS / 1000);
    res.set("X-Cache", "MISS");
    return success(res, data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
