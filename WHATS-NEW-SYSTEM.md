# What's New System Documentation

The What's New system allows components to define their latest features and have them displayed automatically on component landing pages and aggregated on the Data Platform umbrella page.

## How It Works

### For Component Writers

Define What's New items in your **component's home/landing page** (e.g., `modules/ROOT/pages/index.adoc` or `antora.yml`):

```asciidoc
= Component Home Page

// What's New Item 1
:component-whats-new-1-title: Redpanda SQL
:component-whats-new-1-desc: Query your streaming data in real-time with SQL. Run analytical queries directly on topics without ETL.
:component-whats-new-1-link: sql:index.adoc
:component-whats-new-1-tag: Cloud BYOC

// What's New Item 2
:component-whats-new-2-title: Enhanced Monitoring
:component-whats-new-2-desc: New Grafana dashboards with real-time metrics
:component-whats-new-2-link: manage:monitoring.adoc
:component-whats-new-2-tag: All Tiers

// Up to 10 items supported (component-whats-new-3-*, component-whats-new-4-*, etc.)
```

### Attribute Reference

Each What's New item requires 4 attributes (where N = 1, 2, 3... up to 10):

| Attribute | Required | Description | Example |
|-----------|----------|-------------|---------|
| `component-whats-new-N-title` | Yes | Feature title (short, punchy) | `Redpanda SQL` |
| `component-whats-new-N-desc` | Yes | Feature description (1-2 sentences) | `Query streaming data in real-time with SQL` |
| `component-whats-new-N-link` | Yes | Link to feature docs (Antora xref format) | `sql:index.adoc` |
| `component-whats-new-N-tag` | No | Badge text (platform/tier info) | `Cloud BYOC`, `Enterprise`, `All Tiers` |

### Display Locations

#### 1. Component Landing Pages (Automatic)

The What's New section automatically appears on component landing pages that use the `component-home-v2` or `component-home-v3` layout.

No template changes needed - just define the attributes and they'll show up!

**Example components:**
- `cloud-data-platform/modules/ROOT/pages/index.adoc`
- `streaming/modules/home/pages/index.adoc`
- `connect/modules/ROOT/pages/index.adoc`

#### 2. Data Platform Umbrella Page (Aggregated)

The Data Platform home aggregates What's New from multiple components:

In `data-platform/modules/ROOT/partials/data-platform.hbs`:
```handlebars
{{#with (aggregate-whats-new site "cloud-data-platform" "streaming" "connect")}}
  {{> whats-new-section items=items}}
{{/with}}
```

This pulls items from each specified component and displays them together.

## Technical Details

### Helpers

**`get-whats-new-items.js`**
- Reads `component-whats-new-*` attributes from current page
- Used automatically by component landing pages
- Returns: `{ items: [], componentName: string, hasItems: boolean }`

**`aggregate-whats-new.js`**
- Collects What's New from multiple components
- Searches each component's home page for attributes
- Used by Data Platform umbrella page
- Returns: `{ items: [], hasItems: boolean }`

Each item includes:
```javascript
{
  title: string,
  desc: string,
  link: string,  // Antora resource reference
  tag: string,   // Optional badge text
  componentName: string,
  componentColor: string,  // Hex color for styling
  index: number
}
```

### Partial

**`whats-new-section.hbs`**
- Reusable section template
- Supports both modes:
  - Automatic (reads from current page)
  - Aggregated (passed items array)

### Styling

Styles defined in `src/css/whats-new.css` (create this):
- `.whats-new-compact` - Main container
- `.whats-new-badge` - NEW badge
- `.whats-new-item` - Individual item card
- `.whats-new-tag` - Platform/tier badge

## Examples

### Cloud Component Home Page

```asciidoc
= Redpanda Cloud
:page-layout: component-home-v2

// What's New - displays automatically
:component-whats-new-1-title: Redpanda SQL
:component-whats-new-1-desc: Query streaming topics with real-time SQL analytics (BYOC only)
:component-whats-new-1-link: sql:index.adoc
:component-whats-new-1-tag: Cloud BYOC

:component-whats-new-2-title: Serverless Autoscaling
:component-whats-new-2-desc: Automatic capacity adjustments based on workload
:component-whats-new-2-link: manage:autoscaling.adoc
:component-whats-new-2-tag: Serverless
```

### Streaming Component

```asciidoc
= Redpanda Streaming
:page-layout: component-home-v3

:component-whats-new-1-title: Kubernetes Operator 2.0
:component-whats-new-1-desc: Enhanced scaling, monitoring, and Day 2 operations
:component-whats-new-1-link: deploy:kubernetes/operator.adoc

:component-whats-new-2-title: ARM64 Support
:component-whats-new-2-desc: Run Redpanda natively on ARM64 processors
:component-whats-new-2-link: deploy:arm64.adoc
```

### Data Platform Umbrella

The Data Platform page automatically shows items from all specified components:

```handlebars
{{!-- In data-platform.hbs --}}
<section class="dp-whats-new">
  {{#with (aggregate-whats-new site "cloud-data-platform" "streaming" "connect")}}
    {{> whats-new-section items=items}}
  {{/with}}
</section>
```

This will display SQL (from cloud), Kubernetes Operator (from streaming), and any Connect features together.

## Best Practices

1. **Keep titles short** - 2-4 words max
2. **Descriptions concise** - 1-2 sentences, focus on benefit
3. **Update regularly** - Remove old items when adding new ones
4. **Use clear tags** - Platform/tier information (Cloud BYOC, Enterprise, etc.)
5. **Link to docs** - Always provide a link to full documentation
6. **Limit items** - Show 1-3 most important features, not everything

## Maintenance

To remove an item, delete its attributes. The numbering doesn't need to be contiguous:

```asciidoc
// This works fine - skipping 2
:component-whats-new-1-title: Feature A
:component-whats-new-3-title: Feature C
```

But for clarity, keep them sequential when possible.

## Troubleshooting

**Q: My What's New section isn't showing**
- Check that attributes start with `component-whats-new-` (not `page-whats-new-`)
- Verify you have at least `-title`, `-desc`, and `-link` for item 1
- Ensure the page uses a component home layout

**Q: Attributes not found on Data Platform**
- Component home page must be at root (`index.adoc`) or in `home/` module
- Attributes must be defined in the page, not in navigation config

**Q: Links broken**
- Use Antora resource syntax: `module:page.adoc`
- Links are relative to the component defining them
