# Metadata UX Improvements - Proposal

## Current Issues

1. **Playground title not visible** - needs investigation after rebuild completes
2. **Sticky eyebrow getting busy** - Type dropdown and availability info below H1 could be better integrated

## Proposed Solution: Compact Inline Metadata

### Design Philosophy
- Keep the sticky bar clean but informative
- Use compact badges matching existing Beta/LA badge style
- Group metadata logically on the right side
- Responsive: stack on mobile

### Visual Layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│ [Component Pill] [Version ▾] [Beta] [LA]  │  [Type: Input ▾] [BYOC]   │
└─────────────────────────────────────────────────────────────────────────┘
```

**Key Features:**
- **Left side:** Component identification (pill, version, status badges)
- **Separator:** Visual divider (subtle 1px line)
- **Right side:** Content metadata (Type dropdown, availability)
- **All compact:** 11-12px font sizes, minimal padding
- **Hover states:** Subtle background changes
- **Mobile:** Metadata wraps to second row with top border

### Benefits

1. **Always Visible**: Type and availability info stays visible when scrolling
2. **Contextual Grouping**: Related info grouped together (identity left, content metadata right)
3. **Cleaner H1**: Removes clutter below title
4. **Consistent Style**: Matches existing badge design language
5. **Responsive**: Gracefully adapts to smaller screens

### Alternative: Secondary Metadata Bar

If inline feels too busy, we could use a collapsible secondary bar:

```
┌─────────────────────────────────────────────────────────────┐
│ [Component Pill] [Version ▾] [Beta] [LA]        [Options ▾] │ ← Main sticky
├─────────────────────────────────────────────────────────────┤
│ Type: Input  •  Available in: Cloud, Self-Managed           │ ← Metadata bar (collapsible)
└─────────────────────────────────────────────────────────────┘
```

**Pros:**
- Even cleaner main sticky bar
- More space for metadata
- Can show/hide as needed

**Cons:**
- Extra click to reveal
- Takes more vertical space when expanded
- More complex interaction

## Recommendation

**Go with Compact Inline approach** because:
- Simpler implementation
- No hidden information
- Consistent with existing design
- Most documentation pages don't have Type dropdown anyway (it's specific to connector docs)

## Implementation Files

- `src/css/metadata-improved.css` - New compact styling (already created)
- `src/partials/article.hbs` - Move metadata block into `.component-indicator-sticky`
- `src/css/doc.css` - Adjust `.component-indicator-sticky` flex layout

## Next Steps

1. ✅ Created improved CSS (metadata-improved.css)
2. Test if playground title is visible after rebuild
3. Get user feedback on inline vs. secondary bar approach
4. Implement chosen approach in article.hbs
5. Test across different page types and viewports
