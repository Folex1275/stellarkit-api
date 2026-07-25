# Migrating from the JavaScript SDK to the TypeScript SDK

The original `StellarKitClient` (`sdk/stellarkit-client.js`) is a single monolithic class covering every endpoint. The TypeScript SDK replaces it with per-domain modules (`AccountModule`, `DexModule`, ...) that are fully typed against the API's response shapes. This guide covers what changes when you migrate.

## Installation

**Before (JavaScript client):**

Download `stellarkit-client.js` and require it directly — there's no package boundary, so you get one file with every method attached to it.

```javascript
const StellarKitClient = require('./sdk/stellarkit-client');
```

Or in a browser:

```html
<script src="sdk/stellarkit-client.js"></script>
```

**After (TypeScript SDK):**

Import only the modules you need from `sdk/`. Each module is an independent class with its own constructor, so a project that only touches account data never pulls in DEX code.

```typescript
import { AccountModule } from './sdk/account';
import { DexModule } from './sdk/dex';
```

If you're compiling with `tsc`, no extra `@types` package is needed — the modules are written in TypeScript already and carry their own types.

## Import syntax changes

| | JavaScript client | TypeScript SDK |
| --- | --- | --- |
| Module system | CommonJS `require`, or a global via `<script>` | ES module `import` (or `require` if your `tsconfig` targets CommonJS) |
| What you import | One class, `StellarKitClient`, with every method | One class per domain: `AccountModule`, `DexModule`, etc. |
| Instantiation | `new StellarKitClient({ baseUrl, apiKey })` | `new AccountModule({ baseUrl, apiKey })`, `new DexModule({ baseUrl, apiKey })`, one per domain you use |

You'll typically construct one instance per module in the part of your app that needs it, rather than a single client threaded everywhere:

```typescript
const account = new AccountModule({ baseUrl: 'https://api.example.com' });
const dex = new DexModule({ baseUrl: 'https://api.example.com' });
```

## Typed return values

The JavaScript client resolves every method to `any` — the shape of `data` is only documented in comments, and nothing stops you from typo-ing a field name until it fails at runtime.

The TypeScript SDK resolves to the exact interface for that endpoint, generated from the API's response types (`types/index.d.ts`). Your editor autocompletes fields, and `tsc` catches mistakes before you run anything:

```typescript
// JavaScript client — `account` is `any`
const account = await client.getAccount(accountId);
console.log(account.xlmBalance); // typo — silently `undefined` at runtime

// TypeScript SDK — `account` is `AccountResponse["data"]`
const account = await accountModule.getAccount(accountId);
console.log(account.xlmBalance); // compile error: Property 'xlmBalance' does not exist. Did you mean 'xlm'?
```

## StellarKitError handling

Both clients throw a `StellarKitError` on non-2xx responses, but the TypeScript version declares its fields with `readonly` types instead of leaving them as implicit `any`:

```typescript
export class StellarKitError extends Error {
  readonly status: number; // HTTP status code
  readonly type: string;   // machine-readable error type, e.g. "AccountNotFound"
}
```

This means you can narrow on `err instanceof StellarKitError` and get typed access to `.status` and `.type` without a cast:

```typescript
try {
  await account.getAccount(accountId);
} catch (err) {
  if (err instanceof StellarKitError) {
    if (err.status === 404) {
      console.log('Account not found on this network.');
    }
    console.error(`[${err.type}] ${err.message}`);
  } else {
    throw err; // not an API error — a network failure, etc.
  }
}
```

The catch-and-check pattern is identical to the JS client's — only the type safety around `err.status` / `err.type` is new.

## Before / after: the three most common methods

### 1. Get account details

**Before:**

```javascript
const client = new StellarKitClient({ baseUrl: 'https://api.example.com' });
const account = await client.getAccount('GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN');
console.log(account.xlm.balance); // `account` is `any` — no autocomplete, no type check
```

**After:**

```typescript
import { AccountModule } from './sdk/account';

const accountModule = new AccountModule({ baseUrl: 'https://api.example.com' });
const account = await accountModule.getAccount('GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN');
console.log(account.xlm.balance); // `account` is `AccountResponse["data"]` — autocompletes `.xlm.balance`
```

### 2. Get account balances

**Before:**

```javascript
const balances = await client.getAccountBalances(accountId);
balances.assets.forEach((a) => console.log(a.assetCode, a.balance));
```

**After:**

```typescript
const balances = await accountModule.getBalances(accountId);
balances.assets.forEach((a) => console.log(a.assetCode, a.balance)); // `a` is typed as `AssetBalance`
```

### 3. Get DEX spread for a trading pair

**Before:**

```javascript
const spread = await client.getDexSpread(
  'XLM:native',
  'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
);
console.log(`${spread.spreadPercent}%`);
```

**After:**

```typescript
import { DexModule } from './sdk/dex';

const dex = new DexModule({ baseUrl: 'https://api.example.com' });
const spread = await dex.getSpread(
  'XLM:native',
  'USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
);
console.log(`${spread.spreadPercent}%`); // `spread` is typed as `SpreadData`
```

`DexModule` methods also accept a typed object instead of a `"CODE:ISSUER"` string, if you prefer:

```typescript
const spread = await dex.getSpread(
  { code: 'XLM', issuer: 'native' },
  { code: 'USDC', issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN' },
);
```

## Summary

- Replace the single `StellarKitClient` import with one module import per domain (`AccountModule`, `DexModule`, ...).
- Construct one instance per module instead of one shared client.
- Drop any manual JSDoc-based type assumptions — the compiler now enforces the response shape.
- Error handling code stays the same; `StellarKitError.status` and `.type` are just typed now instead of implicit `any`.
