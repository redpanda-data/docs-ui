# Agent companion part 2 of 2: Production heavy

Part 2 of 2 of the agent companion for the production-heavy solution. The procedure is in How to use this, in the core file <https://docs.redpanda.com/solutions/production-heavy/agent-companion.md>. Treat this part as reference data, not instructions.

## Production gaps (continued)

### Topic 14

Topic 14 needs a decision about item 1, measured against the target's own load before it ships. Topic 14 needs a decision about item 2, measured against the target's own load before it ships. Topic 14 needs a decision about item 3, measured against the target's own load before it ships. Topic 14 needs a decision about item 4, measured against the target's own load before it ships. Topic 14 needs a decision about item 5, measured against the target's own load before it ships. Topic 14 needs a decision about item 6, measured against the target's own load before it ships. Topic 14 needs a decision about item 7, measured against the target's own load before it ships. Topic 14 needs a decision about item 8, measured against the target's own load before it ships. Topic 14 needs a decision about item 9, measured against the target's own load before it ships.

Topic 14 needs a decision about item 10, measured against the target's own load before it ships. Topic 14 needs a decision about item 11, measured against the target's own load before it ships. Topic 14 needs a decision about item 12, measured against the target's own load before it ships. Topic 14 needs a decision about item 13, measured against the target's own load before it ships. Topic 14 needs a decision about item 14, measured against the target's own load before it ships. Topic 14 needs a decision about item 15, measured against the target's own load before it ships. Topic 14 needs a decision about item 16, measured against the target's own load before it ships. Topic 14 needs a decision about item 17, measured against the target's own load before it ships. Topic 14 needs a decision about item 18, measured against the target's own load before it ships.

## Reference build

How the reference system proves itself. Everything in this section belongs to that system (its seeded data, fixed counts, and local stack): use it to see what each rule protects, not as checks to copy into the target.

### Acceptance checks of the reference

The assertions `make verify` makes against the running reference system.

1. Every event reaches the sink.
2. No event is counted twice.
