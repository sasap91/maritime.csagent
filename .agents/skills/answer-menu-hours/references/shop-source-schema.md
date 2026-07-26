# Shop Source Markdown Schema

Use these versioned formats for source files referenced by `seed-shops.json`. Keep
customer-facing wording from the source; do not invent missing values merely to satisfy
the schema.

## Common rules

- Save one `menu.md` and one `hours.md` under `shop-data/<shop-slug>/`.
- Start with YAML frontmatter and use the same lowercase slug as `seed-shops.json`.
- Use UTF-8, ATX headings (`#`), Markdown tables, and `—` for a deliberately unavailable
  or inapplicable value.
- Escape literal table pipes as `\|`.
- End with an italic provenance or freshness note when known.

## Menu: `counter-shop-menu-v1`

```yaml
---
schema: counter-shop-menu-v1
shop: example-shop
document: menu
currency: USD
---
```

Follow the frontmatter with one H1 title. Use either profile below; profiles may coexist
when the source requires both.

### Compact profile

Use an H2 per menu section followed by a table. Require `Item` and `Price`; include
`Description` when available. Technical columns such as `Item ID` and `Image` are
optional.

```markdown
## Pizza

| Item | Price | Description |
|---|---|---|
| Cheese | Small $10 \| Large $15 | Classic cheese pizza. |
```

### Detailed profile

Use an H2 per section and an H3 per item. Put an optional description immediately below
the item heading. Require a variant table with `Size / Variant` and `Base Price`.
Technical ID and modifier-summary columns are optional.

When options exist, use `#### Customization Options`, then an H5 for each variant. Name
each modifier group in bold, include selection rules in parentheses, and list options as
`- Option — included` or `- Option — $1.00`.

```markdown
## Pizza

### Cheese Pizza

Classic cheese pizza.

| Size / Variant | Base Price |
|---|---:|
| Small | $10.00 |
| Large | $15.00 |

#### Customization Options

##### Large

**Add Toppings** (optional; select up to 2)

- Pepperoni — $1.00
- Onions — included
```

## Hours: `counter-shop-hours-v1`

```yaml
---
schema: counter-shop-hours-v1
shop: example-shop
document: hours
timezone: America/New_York
---
```

Follow the frontmatter with one H1 title, then `**Location:**` and optionally
`**Phone:**`. List all seven days exactly once in a `Day | Hours` table. Use explicit
12-hour time ranges or one of `Closed`, `Not listed`, or `Closed / not listed`. A closing
time earlier than its opening time means service continues past midnight.

```markdown
# Example Shop Hours

**Location:** 1 Main St, Boston, MA 02110
**Phone:** (617) 555-0100

| Day | Hours |
|---|---|
| Monday | 10:00 AM - 8:00 PM |
| Tuesday | Closed |
```

## Freeform compatibility

Files without recognized frontmatter remain valid inputs for the answering skill. Parse
their headings, tables, prose, and lists conservatively; never treat layout as permission
to infer missing facts. Normalize a freeform file to this schema when maintaining it.
