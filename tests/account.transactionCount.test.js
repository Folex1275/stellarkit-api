const request = require("supertest");
const app = require("../src/index");
const { server } = require("../src/config/stellar");

const ACCOUNT_ID = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
const HORIZON_404 = { response: { status: 404 } };

jest.mock("../src/config/stellar", () => {
  const actual = jest.requireActual("../src/config/stellar");
  return {
    ...actual,
    server: {
      loadAccount: jest.fn(),
      transactions: jest.fn(),
    },
  };
});

function chainForPages(pages) {
  let call = 0;
  return {
    forAccount: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    cursor: jest.fn().mockReturnThis(),
    call: jest.fn().mockImplementation(() => Promise.resolve(pages[call++] || { records: [] })),
  };
}

describe("GET /account/:id/transaction-count", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 400 for an invalid account id", async () => {
    const res = await request(app).get("/account/notakey/transaction-count");

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("ValidationError");
  });

  it("returns 404 when the account does not exist", async () => {
    server.loadAccount.mockRejectedValue(HORIZON_404);

    const res = await request(app).get(`/account/${ACCOUNT_ID}/transaction-count`);

    expect(res.statusCode).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.type).toBe("AccountNotFound");
  });

  it("returns count: 0 and null timestamps for an account with no transaction history", async () => {
    server.loadAccount.mockResolvedValue({ id: ACCOUNT_ID });
    server.transactions.mockReturnValue(chainForPages([{ records: [] }]));

    const res = await request(app).get(`/account/${ACCOUNT_ID}/transaction-count`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual({
      count: 0,
      firstTransactionAt: null,
      lastTransactionAt: null,
    });
  });

  it("returns count and ISO 8601 first/last timestamps for a single page of history", async () => {
    server.loadAccount.mockResolvedValue({ id: ACCOUNT_ID });
    server.transactions.mockReturnValue(
      chainForPages([
        {
          records: [
            { created_at: "2020-01-01T00:00:00Z", paging_token: "1" },
            { created_at: "2020-06-15T10:30:45Z", paging_token: "2" },
          ],
        },
      ]),
    );

    const res = await request(app).get(`/account/${ACCOUNT_ID}/transaction-count`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.count).toBe(2);
    expect(res.body.data.firstTransactionAt).toBe("2020-01-01T00:00:00.000Z");
    expect(res.body.data.lastTransactionAt).toBe("2020-06-15T10:30:45.000Z");
  });

  it("paginates through multiple pages and sums the total count", async () => {
    server.loadAccount.mockResolvedValue({ id: ACCOUNT_ID });
    const fullPage = {
      records: Array.from({ length: 200 }, (_, i) => ({
        created_at: `2021-01-01T00:00:${String(i % 60).padStart(2, "0")}Z`,
        paging_token: `page1-${i}`,
      })),
    };
    const lastPage = {
      records: [{ created_at: "2022-12-31T23:59:59Z", paging_token: "page2-0" }],
    };
    server.transactions.mockReturnValue(chainForPages([fullPage, lastPage]));

    const res = await request(app).get(`/account/${ACCOUNT_ID}/transaction-count`);

    expect(res.statusCode).toBe(200);
    expect(res.body.data.count).toBe(201);
    expect(res.body.data.firstTransactionAt).toBe("2021-01-01T00:00:00.000Z");
    expect(res.body.data.lastTransactionAt).toBe("2022-12-31T23:59:59.000Z");
  });

  it("returns 500 when Horizon is unreachable while fetching transactions", async () => {
    server.loadAccount.mockResolvedValue({ id: ACCOUNT_ID });
    server.transactions.mockReturnValue({
      forAccount: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      cursor: jest.fn().mockReturnThis(),
      call: jest.fn().mockRejectedValue(new Error("network error")),
    });

    const res = await request(app).get(`/account/${ACCOUNT_ID}/transaction-count`);

    expect(res.statusCode).toBe(500);
    expect(res.body.success).toBe(false);
  });
});
