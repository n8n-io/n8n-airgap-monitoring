import { expect, test } from "vitest";
import { LABEL_MAX_LENGTH, sanitizeLabel } from "./label";

test.each([
  ["kiwi-prod", "kiwi-prod"],
  ["Kiwi prod", "kiwi-prod"],
  ["Acme Prod / EU", "acme-prod-eu"],
  ["prod_eu.west", "prod-eu-west"],
  ["v2.40.6 (beta)", "v2-40-6-beta"],
  ["a   b___c", "a-b-c"],
  ["  --main--  ", "main"],
  ["Café Zürich", "cafe-zurich"],
  ["ﬁnance", "finance"],
  ["🚀 launch", "launch"],
  // No accent-free form, so the letter is dropped. Accepted for a display name.
  ["Straße", "stra-e"],
])("sanitizes %j to %j", (raw, expected) => {
  expect(sanitizeLabel(raw)).toBe(expected);
});

test.each(["!!!", "---"])("returns undefined when nothing of %j is left", (raw) => {
  expect(sanitizeLabel(raw)).toBeUndefined();
});

test("keeps a label at the maximum length", () => {
  const raw = "x".repeat(LABEL_MAX_LENGTH);

  expect(sanitizeLabel(raw)).toBe(raw);
});

test("cuts a longer label without leaving a trailing hyphen", () => {
  // The cut falls right after the hyphen that replaced the space.
  const label = sanitizeLabel(`${"x".repeat(LABEL_MAX_LENGTH - 1)} ${"y".repeat(500)}`);

  expect(label).toBe("x".repeat(LABEL_MAX_LENGTH - 1));
});
