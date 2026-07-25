const request = require("supertest");
const app = require("../src/index");
const { server } = require("../src/config/stellar");

jest.mock("../src/config/stellar", () => {
  const originalModule = jest.requireActual("../src/config/stellar");
  return {
    ...originalModule,
    server: {
      trades: jest.fn(),
      orderbook: jest.fn(),
    },
  };
});

const USDC_ISSUER = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const EURT_ISSUER = "GBBD67V63DU762S2CFFSBCS74K33Z6S5Y6R4E62Y7Z66I264S4UBC5U6";

function nativeUsdcTrade(overrides = {}) {
  return {
    base_asset_type: "native",
    base_amount: "10.0000000",
    counter_asset_type: "credit_alphanum4",
    counter_asset_code: "USDC",
    counter_asset_issuer: USDC_ISSUER,
    counter_amount: "1.0000000",
    ...overrides,
  };
}

describe("GET /dex/top-markets", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    server.orderbook.mockReturnValue({
      limit: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({
        bids: [{ price: "0.0990000", amount: "100.0000000" }],
        asks: [{ price: "0.1010000", amount: "100.0000000" }],
      }),
    });
  });

  it("aggregates recent trades into ranked markets with spread", async () => {
    server.trades.mockReturnValue({
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({
        records: [nativeUsdcTrade(), nativeUsdcTrade(), nativeUsdcTrade()],
      }),
    });

    const res = await request(app).get("/dex/top-markets");

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(1);

    const market = res.body.data[0];
    expect(market.baseAsset).toEqual({ code: "XLM", issuer: null, type: "native" });
    expect(market.counterAsset).toEqual({ code: "USDC", issuer: USDC_ISSUER, type: "credit_alphanum4" });
    expect(market.tradeCount).toBe(3);
    expect(market.baseVolume).toBe("30.0000000");
    expect(market.counterVolume).toBe("3.0000000");
    expect(market.spread).toBe("2.0000");
  });

  it("groups distinct pairs separately and ranks by trade count", async () => {
    server.trades.mockReturnValue({
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({
        records: [
          nativeUsdcTrade(),
          nativeUsdcTrade(),
          {
            base_asset_type: "native",
            base_amount: "5.0000000",
            counter_asset_type: "credit_alphanum4",
            counter_asset_code: "EURT",
            counter_asset_issuer: EURT_ISSUER,
            counter_amount: "0.5000000",
          },
        ],
      }),
    });

    const res = await request(app).get("/dex/top-markets?limit=1");

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].counterAsset.code).toBe("USDC");
    expect(res.body.data[0].tradeCount).toBe(2);
  });

  it("returns an empty array when there are no recent trades", async () => {
    server.trades.mockReturnValue({
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({ records: [] }),
    });

    const res = await request(app).get("/dex/top-markets");

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
  });

  it("returns null spread when no order book exists for a market", async () => {
    server.trades.mockReturnValue({
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({ records: [nativeUsdcTrade()] }),
    });
    server.orderbook.mockReturnValue({
      limit: jest.fn().mockReturnThis(),
      call: jest.fn().mockRejectedValue(new Error("no order book")),
    });

    const res = await request(app).get("/dex/top-markets");

    expect(res.statusCode).toBe(200);
    expect(res.body.data[0].spread).toBeNull();
  });

  it("returns 400 for an invalid limit", async () => {
    const res = await request(app).get("/dex/top-markets?limit=0");

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("ValidationError");
  });

  it("returns 400 when limit exceeds the maximum", async () => {
    const res = await request(app).get("/dex/top-markets?limit=51");

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
