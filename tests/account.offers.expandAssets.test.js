/**
 * Tests for GET /account/:id/offers?expandAssets=true
 *
 * Covers:
 *   - Default behaviour (expandAssets omitted) returns simplified asset fields
 *     spread directly onto selling/buying (backward-compatible).
 *   - ?expandAssets=true embeds full { code, issuer, type } asset objects
 *     nested under selling.asset and buying.asset.
 *   - Both native (XLM) and credit assets are handled correctly in both modes.
 */
const request = require("supertest");
const app = require("../src/index");
const { server } = require("../src/config/stellar");
const { Keypair } = require("@stellar/stellar-sdk");

jest.mock("../src/config/stellar", () => ({
  ...jest.requireActual("../src/config/stellar"),
  server: { offers: jest.fn() },
}));

const accountId = Keypair.random().publicKey();
const ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

// Shared mock offers for all tests in this file
const mockOffers = [
  {
    id: "42",
    seller: accountId,
    // Selling: native XLM
    selling_asset_type: "native",
    selling_asset_code: undefined,
    selling_asset_issuer: undefined,
    // Buying: a credit asset
    buying_asset_type: "credit_alphanum4",
    buying_asset_code: "USDC",
    buying_asset_issuer: ISSUER,
    amount: "250.0000000",
    price: "2.0",
    price_r: { n: 2, d: 1 },
    last_modified_ledger: 99999,
    paging_token: "tok1",
  },
  {
    id: "43",
    seller: accountId,
    // Selling: a credit asset
    selling_asset_type: "credit_alphanum12",
    selling_asset_code: "LONGTOKEN12",
    selling_asset_issuer: ISSUER,
    // Buying: native XLM
    buying_asset_type: "native",
    buying_asset_code: undefined,
    buying_asset_issuer: undefined,
    amount: "10.5000000",
    price: "0.5",
    price_r: { n: 1, d: 2 },
    last_modified_ledger: 99998,
    paging_token: "tok2",
  },
];

// Wire up the Horizon mock before every test
beforeEach(() => {
  jest.clearAllMocks();
  server.offers.mockReturnValue({
    forAccount: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnThis(),
    call: jest.fn().mockResolvedValue({ records: mockOffers }),
  });
});

// ── Default behaviour (no expandAssets) ────────────────────────────────────

describe("GET /account/:id/offers — default (no expandAssets)", () => {
  it("returns 200 with items array", async () => {
    const res = await request(app).get(`/account/${accountId}/offers`);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.items).toHaveLength(2);
  });

  it("selling has code, issuer, type spread at top-level (not nested under .asset)", async () => {
    const res = await request(app).get(`/account/${accountId}/offers`);
    const offer = res.body.data.items[0];

    // Fields spread directly onto selling — backward-compatible shape
    expect(offer.selling).toHaveProperty("code");
    expect(offer.selling).toHaveProperty("issuer");
    expect(offer.selling).toHaveProperty("type");

    // No nested asset object in default mode
    expect(offer.selling.asset).toBeUndefined();
  });

  it("buying has code, issuer, type spread at top-level (not nested under .asset)", async () => {
    const res = await request(app).get(`/account/${accountId}/offers`);
    const offer = res.body.data.items[0];

    expect(offer.buying).toHaveProperty("code");
    expect(offer.buying).toHaveProperty("issuer");
    expect(offer.buying).toHaveProperty("type");
    expect(offer.buying.asset).toBeUndefined();
  });

  it("native selling normalises to { code: XLM, issuer: null, type: native }", async () => {
    const res = await request(app).get(`/account/${accountId}/offers`);
    const { selling } = res.body.data.items[0];
    expect(selling.code).toBe("XLM");
    expect(selling.issuer).toBeNull();
    expect(selling.type).toBe("native");
  });

  it("credit buying asset carries correct code, issuer, type", async () => {
    const res = await request(app).get(`/account/${accountId}/offers`);
    const { buying } = res.body.data.items[0];
    expect(buying.code).toBe("USDC");
    expect(buying.issuer).toBe(ISSUER);
    expect(buying.type).toBe("credit_alphanum4");
  });
});

// ── Expanded mode (?expandAssets=true) ────────────────────────────────────

describe("GET /account/:id/offers?expandAssets=true", () => {
  it("returns 200 with items array", async () => {
    const res = await request(app).get(
      `/account/${accountId}/offers?expandAssets=true`,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.items).toHaveLength(2);
  });

  it("selling embeds full asset object at selling.asset", async () => {
    const res = await request(app).get(
      `/account/${accountId}/offers?expandAssets=true`,
    );
    const offer = res.body.data.items[0];

    // In expanded mode selling.asset holds the full object
    expect(offer.selling).toHaveProperty("asset");
    expect(offer.selling.asset).toHaveProperty("code");
    expect(offer.selling.asset).toHaveProperty("issuer");
    expect(offer.selling.asset).toHaveProperty("type");

    // code/issuer/type must NOT be spread directly onto selling itself
    expect(offer.selling.code).toBeUndefined();
    expect(offer.selling.issuer).toBeUndefined();
    expect(offer.selling.type).toBeUndefined();
  });

  it("buying embeds full asset object at buying.asset", async () => {
    const res = await request(app).get(
      `/account/${accountId}/offers?expandAssets=true`,
    );
    const offer = res.body.data.items[0];

    expect(offer.buying).toHaveProperty("asset");
    expect(offer.buying.asset).toHaveProperty("code");
    expect(offer.buying.asset).toHaveProperty("issuer");
    expect(offer.buying.asset).toHaveProperty("type");

    expect(offer.buying.code).toBeUndefined();
    expect(offer.buying.issuer).toBeUndefined();
    expect(offer.buying.type).toBeUndefined();
  });

  it("native selling asset resolves to { code: XLM, issuer: null, type: native } inside selling.asset", async () => {
    const res = await request(app).get(
      `/account/${accountId}/offers?expandAssets=true`,
    );
    const { selling } = res.body.data.items[0];
    expect(selling.asset.code).toBe("XLM");
    expect(selling.asset.issuer).toBeNull();
    expect(selling.asset.type).toBe("native");
  });

  it("credit buying asset has correct code, issuer, type inside buying.asset", async () => {
    const res = await request(app).get(
      `/account/${accountId}/offers?expandAssets=true`,
    );
    const { buying } = res.body.data.items[0];
    expect(buying.asset.code).toBe("USDC");
    expect(buying.asset.issuer).toBe(ISSUER);
    expect(buying.asset.type).toBe("credit_alphanum4");
  });

  it("amount is still present on selling in expanded mode", async () => {
    const res = await request(app).get(
      `/account/${accountId}/offers?expandAssets=true`,
    );
    const offer = res.body.data.items[0];
    expect(offer.selling).toHaveProperty("amount");
    expect(offer.selling.amount).toBe("250.0000000");
  });

  it("price and lastModifiedLedger are present in expanded mode", async () => {
    const res = await request(app).get(
      `/account/${accountId}/offers?expandAssets=true`,
    );
    const offer = res.body.data.items[0];
    expect(offer).toHaveProperty("price", "2.0000000");
    expect(offer).toHaveProperty("lastModifiedLedger", 99999);
  });

  it("alphanum12 selling asset carries correct type in expanded mode", async () => {
    const res = await request(app).get(
      `/account/${accountId}/offers?expandAssets=true`,
    );
    const offer = res.body.data.items[1]; // second offer sells LONGTOKEN12
    expect(offer.selling.asset.code).toBe("LONGTOKEN12");
    expect(offer.selling.asset.issuer).toBe(ISSUER);
    expect(offer.selling.asset.type).toBe("credit_alphanum12");
  });

  it("expandAssets=false falls back to default (simplified) behaviour", async () => {
    const res = await request(app).get(
      `/account/${accountId}/offers?expandAssets=false`,
    );
    expect(res.statusCode).toBe(200);
    const offer = res.body.data.items[0];

    // Default shape: fields spread onto selling, no nested .asset
    expect(offer.selling).toHaveProperty("code");
    expect(offer.selling.asset).toBeUndefined();
  });
});
