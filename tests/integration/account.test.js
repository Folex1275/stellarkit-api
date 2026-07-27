/**
 * tests/integration/account.test.js
 *
 * Integration tests for account endpoints against the real Stellar Testnet.
 *
 * These tests require:
 *   - A known funded Testnet account address stored in the TEST_ACCOUNT env var.
 *   - Live network access to horizon-testnet.stellar.org.
 *
 * Tests are skipped automatically when TEST_ACCOUNT is not set, so they are
 * safe to include in CI pipelines — just set the env var to opt in.
 *
 * Usage:
 *   TEST_ACCOUNT=GABC...XYZ npx jest tests/integration/account.test.js
 *
 * The account must be funded (i.e. exist on Testnet). Use Friendbot to create
 * one: https://friendbot.stellar.org/?addr=<your-public-key>
 */

"use strict";

const request = require("supertest");
const app = require("../../src/index");

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Skip an entire describe block when TEST_ACCOUNT is absent. */
function describeIfAccount(name, fn) {
  const account = process.env.TEST_ACCOUNT;
  if (!account) {
    describe.skip(`${name} [skipped: TEST_ACCOUNT not set]`, fn);
  } else {
    describe(name, fn);
  }
}

const TEST_ACCOUNT = process.env.TEST_ACCOUNT;

// Increase timeout — real Horizon calls can be slow on Testnet.
jest.setTimeout(30000);

// ── Tests ────────────────────────────────────────────────────────────────────

describeIfAccount("Integration — Account endpoints (real Testnet)", () => {
  // ── 1. Balances ─────────────────────────────────────────────────────────

  describe("GET /account/:id/balances", () => {
    it("returns 200 with normalised balance shape", async () => {
      const res = await request(app).get(`/account/${TEST_ACCOUNT}/balances`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);

      const { data } = res.body;
      // Top-level shape
      expect(data).toHaveProperty("xlm");
      expect(data).toHaveProperty("assets");
      expect(Array.isArray(data.assets)).toBe(true);

      // XLM object shape
      const { xlm } = data;
      expect(xlm).toHaveProperty("balance");
      expect(xlm).toHaveProperty("buyingLiabilities");
      expect(xlm).toHaveProperty("sellingLiabilities");
      // Balances are 7-decimal strings
      expect(typeof xlm.balance).toBe("string");
      expect(xlm.balance).toMatch(/^\d+\.\d{7}$/);

      // Each non-native asset has required fields
      data.assets.forEach((asset) => {
        expect(asset).toHaveProperty("asset");
        expect(asset.asset).toHaveProperty("code");
        expect(asset.asset).toHaveProperty("issuer");
        expect(asset.asset).toHaveProperty("type");
        expect(asset).toHaveProperty("balance");
        expect(asset).toHaveProperty("limit");
      });
    });
  });

  // ── 2. Trustlines ────────────────────────────────────────────────────────

  describe("GET /account/:id/trustlines", () => {
    it("returns 200 with normalised trustline shape", async () => {
      const res = await request(app).get(`/account/${TEST_ACCOUNT}/trustlines`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);

      const { data } = res.body;
      expect(data).toHaveProperty("trustlines");
      expect(Array.isArray(data.trustlines)).toBe(true);
      expect(data).toHaveProperty("count");
      expect(typeof data.count).toBe("number");

      // Each trustline has the normalised shape
      data.trustlines.forEach((tl) => {
        expect(tl).toHaveProperty("asset");
        expect(tl.asset).toHaveProperty("code");
        expect(tl.asset).toHaveProperty("issuer");
        expect(tl.asset).toHaveProperty("type");
        expect(tl).toHaveProperty("balance");
        expect(tl).toHaveProperty("limit");
        expect(tl).toHaveProperty("isAuthorized");
        // toml is null or an object — both are valid
        expect(tl).toHaveProperty("toml");
      });
    });

    it("sets X-Cache header", async () => {
      // First call — always a MISS when cache is cold
      const res = await request(app).get(`/account/${TEST_ACCOUNT}/trustlines`);
      expect(["HIT", "MISS"]).toContain(res.headers["x-cache"]);
    });

    it("?fresh=true forces a cache MISS", async () => {
      // Prime the cache
      await request(app).get(`/account/${TEST_ACCOUNT}/trustlines`);
      // Force a fresh fetch
      const res = await request(app).get(
        `/account/${TEST_ACCOUNT}/trustlines?fresh=true`
      );
      expect(res.statusCode).toBe(200);
      expect(res.headers["x-cache"]).toBe("MISS");
    });
  });

  // ── 3. Transactions ──────────────────────────────────────────────────────

  describe("GET /transactions/:id", () => {
    it("returns 200 with normalised transaction shape", async () => {
      const res = await request(app)
        .get(`/transactions/${TEST_ACCOUNT}?limit=5`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);

      const { data } = res.body;
      expect(data).toHaveProperty("items");
      expect(Array.isArray(data.items)).toBe(true);
      expect(data).toHaveProperty("total");
      expect(data).toHaveProperty("limit", 5);
      expect(data).toHaveProperty("cursor");

      // Verify each transaction has the expected fields
      data.items.forEach((tx) => {
        expect(tx).toHaveProperty("id");
        expect(tx).toHaveProperty("hash");
        expect(typeof tx.hash).toBe("string");
        expect(tx.hash).toHaveLength(64);
        expect(tx).toHaveProperty("ledger");
        expect(tx).toHaveProperty("createdAt");
        expect(tx).toHaveProperty("sourceAccount");
        expect(tx).toHaveProperty("fee");
        expect(tx.fee).toHaveProperty("charged");
        expect(tx.fee).toHaveProperty("chargedInXLM");
        expect(tx).toHaveProperty("feeSummary");
        expect(tx.feeSummary).toHaveProperty("chargedInStroops");
        expect(tx.feeSummary).toHaveProperty("chargedInXLM");
        expect(tx).toHaveProperty("operationCount");
        expect(tx).toHaveProperty("successful");
        // createdAt is a valid ISO 8601 timestamp
        expect(new Date(tx.createdAt).toISOString()).toBe(tx.createdAt);
      });
    });
  });

  // ── 4. Offers ────────────────────────────────────────────────────────────

  describe("GET /account/:id/offers", () => {
    it("returns 200 with normalised offers shape", async () => {
      const res = await request(app)
        .get(`/account/${TEST_ACCOUNT}/offers?limit=5`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);

      const { data } = res.body;
      expect(data).toHaveProperty("items");
      expect(Array.isArray(data.items)).toBe(true);
      expect(data).toHaveProperty("total");
      expect(data).toHaveProperty("limit", 5);
      expect(data).toHaveProperty("cursor");

      // Each offer has the expected normalised fields
      data.items.forEach((offer) => {
        expect(offer).toHaveProperty("id");
        expect(offer).toHaveProperty("seller");
        expect(offer).toHaveProperty("selling");
        expect(offer.selling).toHaveProperty("amount");
        expect(offer).toHaveProperty("buying");
        expect(offer.buying).toHaveProperty("code");
        expect(offer.buying).toHaveProperty("issuer");
        expect(offer.buying).toHaveProperty("type");
        expect(offer).toHaveProperty("price");
        // Price formatted to 7 decimal places
        expect(offer.price).toMatch(/^\d+\.\d{7}$/);
        expect(offer).toHaveProperty("lastModifiedLedger");
      });
    });
  });

  // ── 5. Effects ───────────────────────────────────────────────────────────

  describe("GET /account/:id/effects", () => {
    it("returns 200 with normalised effects shape", async () => {
      const res = await request(app)
        .get(`/account/${TEST_ACCOUNT}/effects?limit=5`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);

      const { data } = res.body;
      expect(data).toHaveProperty("items");
      expect(Array.isArray(data.items)).toBe(true);
      expect(data).toHaveProperty("total");
      expect(data).toHaveProperty("limit", 5);
      expect(data).toHaveProperty("cursor");

      // Each effect has the required normalised fields
      data.items.forEach((effect) => {
        expect(effect).toHaveProperty("id");
        expect(effect).toHaveProperty("type");
        expect(typeof effect.type).toBe("string");
        expect(effect).toHaveProperty("account");
        expect(effect).toHaveProperty("createdAt");
        expect(effect).toHaveProperty("pagingToken");
        // createdAt is a valid ISO 8601 timestamp
        expect(new Date(effect.createdAt).toISOString()).toBe(effect.createdAt);
      });
    });

    it("sets X-Cache header", async () => {
      const res = await request(app)
        .get(`/account/${TEST_ACCOUNT}/effects?limit=5`);
      expect(["HIT", "MISS"]).toContain(res.headers["x-cache"]);
    });

    it("?fresh=true forces a cache MISS", async () => {
      await request(app).get(`/account/${TEST_ACCOUNT}/effects?limit=5`);
      const res = await request(app)
        .get(`/account/${TEST_ACCOUNT}/effects?limit=5&fresh=true`);
      expect(res.statusCode).toBe(200);
      expect(res.headers["x-cache"]).toBe("MISS");
    });
  });

  // ── 6. Trades ────────────────────────────────────────────────────────────

  describe("GET /account/:id/trades", () => {
    it("returns 200 with normalised trades shape", async () => {
      const res = await request(app)
        .get(`/account/${TEST_ACCOUNT}/trades?limit=5`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);

      const { data } = res.body;
      expect(data).toHaveProperty("items");
      expect(Array.isArray(data.items)).toBe(true);
      expect(data).toHaveProperty("total");
      expect(data).toHaveProperty("limit", 5);
      expect(data).toHaveProperty("cursor");

      // Each trade has the required normalised fields
      data.items.forEach((trade) => {
        expect(trade).toHaveProperty("id");
        expect(trade).toHaveProperty("pagingToken");
        expect(trade).toHaveProperty("ledgerCloseTime");
        expect(trade).toHaveProperty("tradeType");
        expect(["buy", "sell"]).toContain(trade.tradeType);
        expect(trade).toHaveProperty("baseAsset");
        expect(trade.baseAsset).toHaveProperty("code");
        expect(trade.baseAsset).toHaveProperty("issuer");
        expect(trade.baseAsset).toHaveProperty("type");
        expect(trade).toHaveProperty("counterAsset");
        expect(trade.counterAsset).toHaveProperty("code");
        expect(trade.counterAsset).toHaveProperty("issuer");
        expect(trade.counterAsset).toHaveProperty("type");
        expect(trade).toHaveProperty("baseAmount");
        expect(trade).toHaveProperty("counterAmount");
        expect(trade).toHaveProperty("baseIsSeller");
        // ledgerCloseTime is a valid ISO 8601 timestamp
        expect(new Date(trade.ledgerCloseTime).toISOString()).toBe(
          trade.ledgerCloseTime
        );
      });
    });

    it("sets X-Cache: MISS on first request", async () => {
      // Flush to ensure a cold cache for this specific key
      const cacheService = require("../../src/services/cache");
      cacheService.flush();

      const res = await request(app)
        .get(`/account/${TEST_ACCOUNT}/trades?limit=5`);
      expect(res.statusCode).toBe(200);
      expect(res.headers["x-cache"]).toBe("MISS");
    });

    it("sets X-Cache: HIT on second request with same params", async () => {
      const url = `/account/${TEST_ACCOUNT}/trades?limit=5&order=desc`;
      await request(app).get(url);
      const res = await request(app).get(url);
      expect(res.statusCode).toBe(200);
      expect(res.headers["x-cache"]).toBe("HIT");
    });

    it("?fresh=true forces a cache MISS", async () => {
      const url = `/account/${TEST_ACCOUNT}/trades?limit=5`;
      await request(app).get(url);
      const res = await request(app).get(`${url}&fresh=true`);
      expect(res.statusCode).toBe(200);
      expect(res.headers["x-cache"]).toBe("MISS");
    });
  });
});
