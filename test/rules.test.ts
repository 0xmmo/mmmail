import { describe, expect, it } from "vitest";
import {
  validateGmailInput,
  validateGraphInput,
  RulesNotSupportedError,
  ReauthRequiredError,
} from "../src/providers/rules.js";

describe("validateGmailInput", () => {
  it("accepts a minimal criteria + action", () => {
    const v = validateGmailInput({
      criteria: { from: "alice@example.com" },
      action: { addLabels: ["Receipts"] },
    });
    expect(v.criteria.from).toBe("alice@example.com");
    expect(v.action.addLabels).toEqual(["Receipts"]);
  });

  it("rejects unknown criteria fields", () => {
    expect(() =>
      validateGmailInput({ criteria: { whoosh: "x" }, action: {} }),
    ).toThrow(/unknown criteria field: whoosh/);
  });

  it("rejects unknown action fields", () => {
    expect(() =>
      validateGmailInput({ criteria: {}, action: { addLabelIds: ["x"] } }),
    ).toThrow(/unknown action field: addLabelIds/);
  });

  it("rejects an empty rule", () => {
    expect(() => validateGmailInput({ criteria: {}, action: {} })).toThrow(
      /neither criteria nor action/,
    );
  });

  it("rejects non-object input", () => {
    expect(() => validateGmailInput("nope")).toThrow(/must be a JSON object/);
    expect(() => validateGmailInput(null)).toThrow(/must be a JSON object/);
  });
});

describe("validateGraphInput", () => {
  it("requires displayName + actions", () => {
    expect(() => validateGraphInput({})).toThrow(/displayName/);
    expect(() => validateGraphInput({ displayName: "x" })).toThrow(/actions/);
  });

  it("rejects empty displayName", () => {
    expect(() =>
      validateGraphInput({ displayName: "   ", actions: {} }),
    ).toThrow(/displayName/);
  });

  it("rejects non-numeric sequence", () => {
    expect(() =>
      validateGraphInput({
        displayName: "r",
        actions: {},
        sequence: "1",
      }),
    ).toThrow(/sequence must be a number/);
  });

  it("rejects non-boolean isEnabled", () => {
    expect(() =>
      validateGraphInput({
        displayName: "r",
        actions: {},
        isEnabled: "yes",
      }),
    ).toThrow(/isEnabled must be a boolean/);
  });

  it("accepts a well-formed rule", () => {
    const v = validateGraphInput({
      displayName: "Move newsletters",
      sequence: 2,
      isEnabled: true,
      conditions: { fromAddresses: [] },
      actions: { moveToFolder: "Newsletters", stopProcessingRules: true },
    });
    expect(v.displayName).toBe("Move newsletters");
    expect(v.actions.moveToFolder).toBe("Newsletters");
  });
});

describe("RulesNotSupportedError / ReauthRequiredError", () => {
  it("carries name + message", () => {
    const a = new RulesNotSupportedError("nope");
    expect(a.name).toBe("RulesNotSupportedError");
    expect(a.message).toBe("nope");
  });
  it("captures email + hint", () => {
    const b = new ReauthRequiredError("me@x.com", "run reauth");
    expect(b.name).toBe("ReauthRequiredError");
    expect(b.email).toBe("me@x.com");
    expect(b.hint).toBe("run reauth");
    expect(b.message).toMatch(/me@x.com/);
    expect(b.message).toMatch(/run reauth/);
  });
});
