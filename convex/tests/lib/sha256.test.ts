import { describe, it, expect } from "vitest";
import { sha256Hex } from "../../lib/sha256";

// FIPS 180-4 / NIST test vectors, plus multi-byte UTF-8 and block-boundary
// lengths (the padding math is the only nontrivial part of the impl).
describe("lib/sha256", () => {
  it("matches the NIST test vectors", () => {
    expect(sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(
      sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
    ).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  });

  it("hashes multi-byte UTF-8 by its byte encoding", () => {
    // printf "Ärger 中文 🙂" | shasum -a 256
    expect(sha256Hex("Ärger 中文 🙂")).toBe(
      "f8828b07e0896d3cb891753ccdd2a4ee4fa7f3b421acde1360338426981ce023",
    );
    expect(sha256Hex("Ärger")).not.toBe(sha256Hex("Arger"));
  });

  it("handles padding across block boundaries (55/56/64-byte messages)", () => {
    // 55 bytes: message + 0x80 + length fits exactly in one block.
    expect(sha256Hex("a".repeat(55))).toBe(
      "9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318",
    );
    // 56 bytes: forces a second block.
    expect(sha256Hex("a".repeat(56))).toBe(
      "b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a",
    );
  });
});
