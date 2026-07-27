const request = require("supertest");

const { server } = require("../src/config/stellar");

jest.mock("../src/config/stellar", () => {
  const originalModule = jest.requireActual("../src/config/stellar");
  return {
    ...originalModule,
    server: {
      accounts: jest.fn(),
      loadAccount: jest.fn(),
      liquidityPools: jest.fn(),
      claimableBalances: jest.fn(),
    },
  };
});

const app = require("../src/index");

describe("response normalization endpoints", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns normalized asset holder responses with the requested envelope", async () => {
    server.accounts.mockReturnValue({
      forAsset: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      cursor: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({
        records: [
          {
            id: "GABC",
            balances: [{ asset_code: "USDC", asset_issuer: "GISSUER", balance: "10.5000000", asset_type: "credit_alphanum4" }],
            paging_token: "tok1",
          },
        ],
      }),
    });

    const res = await request(app)
      .get("/asset/USDC/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7/holders")
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      holders: [{ address: "GABC", balance: "10.5000000" }],
      total: 1,
      limit: 10,
      cursor: null,
    });
    expect(res.body.data.holders[0]).not.toHaveProperty("paging_token");
  });

  it("normalizes pool positions asset fields and decimal strings", async () => {
    server.loadAccount.mockResolvedValue({
      balances: [
        {
          asset_type: "liquidity_pool_shares",
          liquidity_pool_id: "pool-id",
          balance: "2.0000000",
        },
      ],
    });

    server.liquidityPools.mockReturnValue({
      liquidityPoolId: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({
        id: "pool-id",
        total_shares: "4.0000000",
        fee_bp: 30,
        total_trustlines: 2,
        last_modified_ledger: 123,
        reserves: [
          { amount: "3.0000000", asset: "native" },
          { amount: "5.0000000", asset: "USDC:GISSUER" },
        ],
      }),
    });

    const res = await request(app)
      .get("/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7/pool-positions")
      .expect(200);

    expect(res.body.data[0]).toMatchObject({
      poolId: "pool-id",
      shares: "2.0000000",
      totalPoolShares: "4.0000000",
      reserveA: {
        asset: { code: "XLM", issuer: null, type: "native" },
        totalAmount: "3.0000000",
        equivalentAmount: "1.5000000",
      },
      reserveB: {
        asset: { code: "USDC", issuer: "GISSUER", type: "credit_alphanum4" },
        totalAmount: "5.0000000",
        equivalentAmount: "2.5000000",
      },
    });
    expect(res.body.data[0]).not.toHaveProperty("liquidity_pool_id");
  });

  it("returns paginated claimable balances for an account", async () => {
    server.claimableBalances.mockReturnValue({
      forClaimant: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      cursor: jest.fn().mockReturnThis(),
      call: jest.fn().mockResolvedValue({
        records: [
          {
            id: "cb-1",
            asset: "credit_alphanum4",
            amount: "12.3400000",
            sponsor: "GSPONSOR",
            created_at: "2024-01-01T00:00:00Z",
            claimants: [{ destination: "GDEST", predicate: { unconditional: true } }],
          },
        ],
      }),
    });

    const res = await request(app)
      .get("/account/GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7/claimable-balances")
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data[0]).toMatchObject({
      balanceId: "cb-1",
      amount: "12.3400000",
      sponsor: "GSPONSOR",
      createdAt: "2024-01-01T00:00:00Z",
      claimants: [{ destination: "GDEST", predicate: { unconditional: true } }],
    });
    expect(res.body.meta).toMatchObject({ count: 1, limit: 10, hasMore: false });
  });
});
