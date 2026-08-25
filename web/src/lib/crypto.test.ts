import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEVICE_TOKEN_PREFIX,
  generateDeviceToken,
  generateEnrollmentCode,
  hashPassword,
  normalizeEnrollmentCode,
  parseDeviceToken,
  safeEqual,
  sha256,
  verifyPassword,
} from "./crypto";

describe("device tokens", () => {
  it("round-trips every generated token", () => {
    // The secret half is base64url, whose alphabet contains `_` -- the same
    // character that separates the token's fields. Generating many tokens is
    // what catches a parser that splits naively: roughly half of all secrets
    // contain at least one underscore.
    for (let i = 0; i < 500; i++) {
      const { token, tokenId, tokenHash } = generateDeviceToken();
      const parsed = parseDeviceToken(token);

      assert.ok(parsed, `token ${token} failed to parse`);
      assert.equal(parsed.tokenId, tokenId);
      assert.equal(sha256(parsed.secret), tokenHash);
    }
  });

  it("produces at least one secret containing the separator", () => {
    // Guards the guard: if this ever stops holding, the test above has lost
    // its teeth and the regression could come back unnoticed.
    const withUnderscore = Array.from({ length: 200 }, () => generateDeviceToken()).some(
      ({ token }) => token.slice(token.indexOf("_", 5) + 1).includes("_"),
    );
    assert.ok(withUnderscore);
  });

  it("rejects malformed tokens", () => {
    const cases = [
      "",
      "nonsense",
      "adgd_short_secret",
      `${DEVICE_TOKEN_PREFIX}_notHex0000000000000000000_secret`,
      `wrongprefix_${"a".repeat(24)}_secret`,
      `${DEVICE_TOKEN_PREFIX}_${"a".repeat(24)}_`,
      `${DEVICE_TOKEN_PREFIX}_${"a".repeat(24)}`,
    ];
    for (const value of cases) {
      assert.equal(parseDeviceToken(value), null, `expected ${value} to be rejected`);
    }
  });
});

describe("enrollment codes", () => {
  it("generates readable grouped codes", () => {
    for (let i = 0; i < 100; i++) {
      const code = generateEnrollmentCode();
      assert.match(code, /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
      // Ambiguous glyphs must never appear.
      assert.ok(!/[ILOU]/.test(code), `code ${code} contains an ambiguous character`);
    }
  });

  it("normalizes user-entered variations to the canonical form", () => {
    const canonical = "K4M2-9QTX-B3RD";
    for (const variant of [
      "k4m2-9qtx-b3rd",
      "K4M29QTXB3RD",
      " K4M2 9QTX B3RD ",
      "k4m2 - 9qtx - b3rd",
    ]) {
      assert.equal(normalizeEnrollmentCode(variant), canonical);
    }
  });
});

describe("hashing", () => {
  it("verifies a correct password and rejects a wrong one", async () => {
    const hash = await hashPassword("CorrectHorse1");
    assert.equal(await verifyPassword("CorrectHorse1", hash), true);
    assert.equal(await verifyPassword("correcthorse1", hash), false);
  });

  it("returns false rather than throwing on a corrupt hash", async () => {
    assert.equal(await verifyPassword("anything", "not-a-bcrypt-hash"), false);
  });

  it("compares in constant time without throwing on length mismatch", () => {
    assert.equal(safeEqual("abc", "abc"), true);
    assert.equal(safeEqual("abc", "abd"), false);
    assert.equal(safeEqual("abc", "abcd"), false);
  });
});
