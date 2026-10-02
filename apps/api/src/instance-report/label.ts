export const LABEL_MAX_LENGTH = 200;

/**
 * Turns a customer-chosen label into a URL-compliant one: lowercase `a-z`,
 * `0-9` and single inner hyphens. Never rejects: anything else is replaced, so
 * a bad label cannot cost a report. Returns undefined when nothing is left,
 * which is stored like an absent label.
 *
 * See adr/2026-10-01-sanitize-the-instance-label.md.
 */
export function sanitizeLabel(raw: string): string | undefined {
  const label = raw
    // Split accented letters into letter + mark, then drop the mark: é → e.
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    // Cut instead of rejected, so a long label cannot cost a report either.
    .slice(0, LABEL_MAX_LENGTH)
    .replace(/-+$/, "");

  return label === "" ? undefined : label;
}
