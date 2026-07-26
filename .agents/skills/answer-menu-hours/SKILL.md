---
name: answer-menu-hours
description: Answer customer questions about a shop's structured or freeform Markdown menu and regular opening hours using repository-grounded source files. Use for item availability, prices, sizes, variants, modifiers, descriptions, listed ingredients, section browsing, opening or closing times, day-specific schedules, and "open now" questions.
---

# Answer Menu and Hours

Give brief, customer-friendly answers grounded only in the shop files referenced by
`seed-shops.json`.

## Resolve the shop sources

1. Identify the shop from the request or conversation context. If multiple shops are
   plausible, ask which shop the customer means.
2. Find the shop by slug in `seed-shops.json`.
3. Read the repository-relative path in `sources.menu` for menu questions or
   `sources.hours` for hours questions. If a source entry is absent, use the inline
   `menu` or `hours` value for that shop.
4. Treat the selected source as authoritative. Do not substitute another restaurant's
   data or browse the web unless the user explicitly requests external verification.

Read [references/shop-source-schema.md](references/shop-source-schema.md) when a source
declares a `counter-shop-*-v1` schema or when creating or changing shop source files.

## Parse menu Markdown

For a schema-compliant compact menu, match the requested item to the `Item` column and
interpret values using the table header rather than fixed column positions.

For a schema-compliant detailed menu:

1. Build an outline from headings.
2. Locate the closest matching `###` item beneath its `##` section.
3. Read from that item heading through the next heading of level 3 or higher.
4. Associate base prices with the requested row in the variant table.
5. Associate modifier prices only with the adjacent variant and modifier group.

For freeform Markdown without recognized frontmatter:

1. Search case-insensitively for the literal item name and plausible spelling variants.
2. Inspect every match in context; do not stop at the first occurrence.
3. Prefer a heading or table row that names the item. Read its surrounding section,
   adjacent table, description, and nested bullets.
4. Keep base price, size or variant, included choices, and paid add-ons distinct.
5. If duplicate names occur in different sections, report the relevant section or ask
   which one the customer means. Do not merge their prices.

Treat headings, tables, prose, and lists as presentation, not proof by themselves.
Preserve explicit qualifiers such as "optional," "included," "select up to," "serves,"
"non-display," and "best seller."

## Parse hours Markdown

Read the complete hours file because it should be short. Use the frontmatter timezone
when present. For freeform files, locate day names, time ranges, closed/not-listed
language, address, phone, timezone, and source notes in tables or prose.

Keep `Closed`, `Not listed`, and `Closed / not listed` distinct. The last two do not prove
that the shop is closed; repeat the source wording and recommend calling when necessary.
For "open now," apply the shop's local day and time. Treat a closing time after midnight
as the continuation of the prior evening's service and mention possible holiday changes.

## Answering rules

- State prices, variants, availability, descriptions, modifier conditions, and hours
  exactly as published.
- Interpret an em dash in a named size as unavailable; never fill gaps by analogy.
- Do not infer ingredients, substitutions, allergens, preparation methods, holiday
  hours, delivery availability, or cross-contamination guarantees from missing data.
- When information is absent or ambiguous, say what is known and provide the shop contact
  from the source file or `seed-shops.json`.
- For allergy questions, report only listed ingredients and recommend contacting the
  shop before ordering.
- Omit internal IDs, image URLs, source paths, and implementation details unless asked.
- Keep a simple answer to one to three sentences. Use a compact list or table for several
  items or a full schedule.

## Examples

- "How much is a large Hawaiian?" Check the exact item and variant. If that size is
  marked unavailable, offer only the other published sizes and prices.
- "Can I add bacon?" Find the relevant item variant and modifier group; distinguish an
  included option from a paid add-on.
- "What time do you close Friday?" Give the Friday closing time and clarify an
  after-midnight closing as late Friday night.
- "Does this contain nuts?" If the source does not say, share the listed description
  without guessing and recommend calling the shop.
