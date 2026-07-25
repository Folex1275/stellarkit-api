const { parsePaginationParams } = require("../src/utils/pagination");

describe("parsePaginationParams", () => {
  it("returns defaults when query is empty", () => {
    const result = parsePaginationParams({});
    expect(result).toEqual({ limit: 20, order: "desc", cursor: undefined });
  });

  it("parses valid limit parameter", () => {
    const result = parsePaginationParams({ limit: 50 });
    expect(result.limit).toBe(50);
  });

  it("converts string limit to number", () => {
    const result = parsePaginationParams({ limit: "25" });
    expect(result.limit).toBe(25);
  });

  it("rejects limit above max — throws isInvalidLimit", () => {
    expect(() => parsePaginationParams({ limit: 300 }, 100)).toThrow(
      "limit must be a number between 1 and 100."
    );
  });

  it("rejects limit=0 — throws isInvalidLimit", () => {
    expect(() => parsePaginationParams({ limit: 0 })).toThrow(
      "limit must be a number between 1 and 100."
    );
  });

  it("rejects non-numeric limit — throws isInvalidLimit", () => {
    expect(() => parsePaginationParams({ limit: "invalid" })).toThrow(
      "limit must be a number between 1 and 100."
    );
  });

  it("parses valid order parameter (asc)", () => {
    const result = parsePaginationParams({ order: "asc" });
    expect(result.order).toBe("asc");
  });

  it("parses valid order parameter (desc)", () => {
    const result = parsePaginationParams({ order: "desc" });
    expect(result.order).toBe("desc");
  });

  it("defaults to desc when order is missing", () => {
    const result = parsePaginationParams({});
    expect(result.order).toBe("desc");
  });

  it("converts order to lowercase", () => {
    const result = parsePaginationParams({ order: "ASC" });
    expect(result.order).toBe("asc");
  });

  it("rejects invalid order parameter", () => {
    expect(() => parsePaginationParams({ order: "invalid" })).toThrow();
  });

  it("parses valid cursor parameter", () => {
    const cursor = "token-123";
    const result = parsePaginationParams({ cursor });
    expect(result.cursor).toBe(cursor);
  });

  it("sets cursor to undefined when not provided", () => {
    const result = parsePaginationParams({});
    expect(result.cursor).toBeUndefined();
  });

  it("respects custom maxLimit parameter", () => {
    const result = parsePaginationParams({ limit: 50 }, 100);
    expect(result.limit).toBe(50);

    expect(() => parsePaginationParams({ limit: 150 }, 100)).toThrow(
      "limit must be a number between 1 and 100."
    );
  });

  it("parses all parameters together", () => {
    const result = parsePaginationParams(
      { limit: "30", order: "asc", cursor: "cursor-abc" },
      100
    );
    expect(result).toEqual({
      limit: 30,
      order: "asc",
      cursor: "cursor-abc",
    });
  });

  it("throws error with isInvalidLimit flag for invalid limit", () => {
    try {
      parsePaginationParams({ limit: -5 });
      throw new Error("Should have thrown");
    } catch (err) {
      expect(err.isInvalidLimit).toBe(true);
      expect(err.message).toBe("limit must be a number between 1 and 100.");
    }
  });

  it("accepts boundary values 1 and 100", () => {
    expect(parsePaginationParams({ limit: 1 }).limit).toBe(1);
    expect(parsePaginationParams({ limit: 100 }).limit).toBe(100);
  });
});
