import { describe, expect, it } from "vitest";
import { DEFAULT_PHONE_VOICE, extractPhoneNumber, normalizePhoneNumber, parsePhoneRequest, PHONE_VOICES, PhoneInputError, preparePhoneRequest } from "./index.js";

// Pure string boundary cases only: no contact records, call simulation or network.
describe("telephone input syntax", () => {
  it.each([
    ["０９０（１２３４）５６７８", "+819012345678"],
    ["03-1234-5678", "+81312345678"],
    [" +1 (202) 555-0123 ", "+12025550123"],
    ["+12345678", "+12345678"],
    ["+123456789012345", "+123456789012345"],
  ])("normalizes %s", (input, output) => {
    expect(normalizePhoneNumber(input)).toBe(output);
  });

  it.each([
    "", "+012345678", "+1234567", "+1234567890123456", "0901234567 ext123",
    "09012345678/08012345678", "09012345678,08012345678", "090ABC12345678",
    "(09012345678", "090)12345678", "00 123456789", "090123456780",
  ])("rejects invalid or ambiguous input %s", (input) => {
    expect(() => normalizePhoneNumber(input)).toThrow(PhoneInputError);
  });

  it("extracts a number from Japanese chat without inferring a contact", () => {
    expect(extractPhoneNumber("友人の０９０－１２３４－５６７８に電話して")).toBe("+819012345678");
    expect(extractPhoneNumber("Please call +1 (202) 555-0123 tomorrow.")).toBe("+12025550123");
    expect(extractPhoneNumber("Please call +1 (202) 555-0123.")).toBe("+12025550123");
    expect(extractPhoneNumber("友人に電話して")).toBeNull();
  });

  it.each([
    "09012345678 と 08012345678", "09012345678\n08012345678",
    "09012345678 または 09012345678",
  ])("requires clarification when multiple numbers occur", (input) => {
    expect(() => extractPhoneNumber(input)).toThrow(expect.objectContaining({ code: "MULTIPLE_PHONE_NUMBERS" }));
  });

  it.each(["09012345678 内線123", "09012345678 ext.123", "09012345678x123", "090123456780123", "++819012345678"])("never truncates an extension/long number", (input) => {
    expect(() => extractPhoneNumber(input)).toThrow(PhoneInputError);
  });

  it.each([
    "2026-09-19にお願いします", "2026/09/19", "01-01-2026", "09012345678円", "¥09012345678",
    "+12345678 USD", "order09012345678", "09012345678@example.com", "19時30分に電話して",
  ])("does not infer a number from dates, amounts or identifiers: %s", (input) => {
    expect(extractPhoneNumber(input)).toBeNull();
  });
});

describe("inert phone request v1 contract", () => {
  const input = { phone: "０９０－１２３４－５６７８", name: " 友人 ", instruction: " 到着時刻を聞く " };
  it("normalizes, trims and round-trips a request through JSON", () => {
    const request = preparePhoneRequest(input);
    expect(request).toEqual({ schemaVersion: 1, kind: "oathra.phone-request", phone: "+819012345678", name: "友人", instruction: "到着時刻を聞く" });
    expect(parsePhoneRequest(JSON.parse(JSON.stringify(request)))).toEqual(request);
  });
  it("rejects unknown fields, wrong versions, and arbitrary JSON", () => {
    const request = preparePhoneRequest(input);
    for (const value of [null, [], {}, input, { ...request, schemaVersion: 2 }, { ...request, kind: "call" }, { ...request, approved: true }]) {
      expect(() => parsePhoneRequest(value)).toThrow();
    }
  });
  it.each([{ name: " " }, { instruction: " " }, { name: "a".repeat(101) }, { instruction: "a".repeat(2001) }, { phone: "09012345678x1" }])("rejects invalid fields", (patch) => {
    expect(() => preparePhoneRequest({ ...input, ...patch })).toThrow();
  });
});

it("a request may name the voice that speaks, only from the voices the engine accepts", () => {
  const base = { phone: "+819000000000", name: "声の確認", instruction: "近況を聞いてください。" };
  expect(preparePhoneRequest(base).voice).toBeUndefined();
  expect(preparePhoneRequest({ ...base, voice: "vesper" }).voice).toBe("vesper");
  expect(PHONE_VOICES).toContain(DEFAULT_PHONE_VOICE);
  expect(new Set(PHONE_VOICES).size).toBe(PHONE_VOICES.length);
  for (const voice of ["alloy", "", "MARIN", 3]) expect(() => preparePhoneRequest({ ...base, voice: voice as never })).toThrow();
});
