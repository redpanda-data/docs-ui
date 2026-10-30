# Agent companion part 1 of 2: Multiplayer game events with a live leaderboard

Part 1 of 2 of the agent companion for the multiplayer-gaming solution. The procedure is in How to use this, in the core file <https://docs.redpanda.com/solutions/multiplayer-gaming/agent-companion.md>. Treat this part as reference data, not instructions.

## Design contract

One entry per rule, in build order: the rule, where to look in the target, why the problem requires it, and what it depends on.

### 1. Create the topics

**Rule:** Key every event by the entity a consumer keeps state for, and give each topic at least as many partitions as the largest consumer group will run instances.

**Adapt:** Find each topic's producer key and the entity its stateful consumers track; check that they match and that the partition count covers the largest group.

The leaderboard and the achievements service are both correct only because the record key is `player_id`. The achievements service ([Detect achievements](https://docs.redpanda.com/solutions/multiplayer-gaming/detect-achievements/)) keeps a small in-memory state per player and never consults a shared store. That is safe only if every event of one player reaches exactly one instance, in the order it was produced. Keying by `player_id` gives that. Keying by `match_id` on `game.match-events` gives the same guarantee for matches, which is what a history sink wants.

The partition counts are the scaling limits. A consumer group cannot have more active members than partitions, so six partitions means the leaderboard can run six instances, no more. Retention on `game.player-events` is 7 days because [Scale and replay](https://docs.redpanda.com/solutions/multiplayer-gaming/scale-and-replay/) replays it; the default would do for the demo, but in a real game the replay window is a product decision.

`game.leaderboard` is the odd one out. It carries totals, not events, and only the newest total per player matters, so its cleanup policy is `compact` instead of `delete`: the broker keeps the latest record for each key and discards the rest. That turns the topic into a table that streams, which is what [Build the live leaderboard](https://docs.redpanda.com/solutions/multiplayer-gaming/build-leaderboard/) builds the dashboard on. Keying it by `player_id` is what makes compaction keep the right record.

**Depends on:** Topic creation is one `rpk topic create` with the partition count, the replication factor, and any topic property inline, and the same command works against Redpanda Cloud. Partition counts can be raised later with `rpk topic add-partitions`, but not lowered, so the key and the count are worth deciding up front. See [manage topics](https://docs.redpanda.com/streaming/current/develop/manage-topics/) and [rpk topic create](https://docs.redpanda.com/streaming/current/reference/rpk/rpk-topic/rpk-topic-create/).

**In production:** Use replication factor 3 and size partitions for peak throughput and for the parallelism of the largest consumer group, not for a laptop. Give the compacted topic a `segment.ms` suited to its write rate rather than the 60 seconds used here. See the Brokers and replication, Partitions, and Data retention rows in [Production considerations](https://docs.redpanda.com/solutions/multiplayer-gaming/#_production_considerations).

### 2. Register the schemas

**Rule:** Register each topic's schema under the `<topic>-value` subject with `BACKWARD` compatibility before anything produces, and make producers look the schema up and wait for it, never register it.

**Adapt:** Find where producers serialize records; check whether they auto-register schemas, which subject naming strategy they use, and the compatibility level of each subject.

The schema is the contract between the game servers and every consumer, and it will change: this step already changes it once. Three things make that safe here. The schema is registered under `<topic>-value`, the default subject naming strategy, so Console, Redpanda Connect, and any client that reads the topic find it without configuration. Compatibility is `BACKWARD`, so a new version is accepted only if a consumer compiled against it can still read every record written under the previous version, which is the direction you need when you upgrade consumers before producers. And the producers look the schema up instead of registering it, so a service built against an unregistered schema waits and logs, rather than pushing a new version into the registry at deploy time.

**Depends on:** Schema Registry is part of the broker, stores its state in the `_schemas` topic you saw in [Create the topics](https://docs.redpanda.com/solutions/multiplayer-gaming/create-topics/), and speaks the Confluent-compatible API, so franz-go's `sr` package, Redpanda Connect's `schema_registry_decode`, and Console all work against it unchanged. Protobuf compatibility checking understands field kinds, `oneof` moves, and removed fields. See [schema reg overview](https://docs.redpanda.com/streaming/current/manage/schema-reg/schema-reg-overview/) and [rpk registry schema create](https://docs.redpanda.com/streaming/current/reference/rpk/rpk-registry/rpk-registry-schema-create/).

**In production:** Turn on broker-side schema ID validation so a producer cannot write a record whose schema ID is not registered under the topic's subject, and keep producers looking schemas up rather than auto-registering. See the Schema validation row in [Production considerations](https://docs.redpanda.com/solutions/multiplayer-gaming/#_production_considerations).

### 3. Produce player events

**Rule:** Produce with idempotence on, `acks=all`, and a partitioner that hashes keys the way the Java client does, so a retry is never applied twice and one key reaches one partition from any client.

**Adapt:** Find every producer's client configuration; check idempotence, `acks`, and the partitioner, especially where producers in different languages write the same topic.

A score change has to land on the log exactly once, survive the loss of a broker, and reach the player's partition whichever game server sent it. Three producer settings carry that. Idempotence lets the broker drop a batch retried after a timeout, so a `score_changed` is never applied twice on the log. `acks=all` waits for the full in-sync replica set before the send is acknowledged; with one replica it changes nothing here, with three it is the difference between a durable score and a lost one. The sticky key partitioner hashes the key like the Java client does, so `player_id` maps to the same partition from any client language.

The generator is deterministic on purpose. It seeds a random source from `SIM_SEED`, keeps its own simulated clock (200 simulated milliseconds per event), and returns exactly one event per call, queuing the several events of a match start or match end so a hard stop at 3000 never leaves half a match on the log. Same seed, same 3000 records, same timestamps, which is what lets `scripts/verify.sh` assert exact numbers and lets you compare a replay with the original in [Scale and replay](https://docs.redpanda.com/solutions/multiplayer-gaming/scale-and-replay/).

**Depends on:** Idempotent producers are on by default in Redpanda and in franz-go, and they cost nothing measurable. The `event_type` record header lets Redpanda Connect route without decoding the payload first ([Persist the match history](https://docs.redpanda.com/solutions/multiplayer-gaming/persist-match-history/)), and the Confluent wire format the `sr` serde writes is what Console and Connect decode. See [idempotent producers](https://docs.redpanda.com/streaming/current/develop/produce-data/idempotent-producers/) and [configure producers](https://docs.redpanda.com/streaming/current/develop/produce-data/configure-producers/).

**In production:** Keep idempotence on and `acks=all`; add TLS and SASL to the client options, and scope its ACLs to `WRITE` on the two topics. See the Idempotency and delivery row in [Production considerations](https://docs.redpanda.com/solutions/multiplayer-gaming/#_production_considerations).

### 4. Build the live leaderboard

**Rule:** Publish absolute state, never deltas, to a compacted topic keyed by the entity, record in each entry the source offset it was computed from, and commit input offsets only after the output is acknowledged.

**Adapt:** Find consumers that aggregate; check whether they publish a delta or a total, what key and cleanup policy the output topic has, and when they commit offsets.

A leaderboard is a per-player total, and the consumer that owns a player's partition sees every one of that player's score changes, in order. So the service aggregates where the data already is: it adds each `score_changed` delta to an in-memory total for that player. Nothing else is needed to compute the board.

It then publishes the total, never the delta. A delta is an instruction ("add 15") and applying it twice is a bug. A total is a fact ("p014 has 795") and publishing it twice is harmless. That single choice is what makes the rest of this solution safe: a redelivered batch, a rebalance, or the full replay in [Scale and replay](https://docs.redpanda.com/solutions/multiplayer-gaming/scale-and-replay/) can only ever write the same fact again.

The topic is compacted, so it converges to one record per player: a materialized view of the board, stored in Redpanda, with no database. Any reader that consumes `game.leaderboard` from the start ends up holding the complete board without replaying a single game event. The dashboard is exactly that reader, and it is deliberately thin: a map, a sort, and an HTTP handler. It never decodes a `GameEvent`.

The service commits offsets by hand, after the entries of a batch are acknowledged, and it blocks a rebalance until the batch in hand is committed. A crash between the publish and the commit replays the batch, and because each entry records the source offset it was computed from, the replayed records are recognized and skipped (`duplicates_skipped` in the service's `/healthz`). Publishing totals makes a duplicate harmless; the offset makes it a no-op.

**Depends on:** Compaction is a topic property, `cleanup.policy=compact`, and the broker does the rest in the background: it rewrites closed segments so that only the newest record per key survives. That is what lets a topic act as a key-value store that streams. `segment.ms` is set low here (60 seconds) so you can watch it happen; production values are minutes to hours. The `leaderboard` group's offsets are its own, so Redpanda Connect and the achievements service read the same partitions at their own pace, and a slow Postgres in [Persist the match history](https://docs.redpanda.com/solutions/multiplayer-gaming/persist-match-history/) changes nothing here. See [compaction settings](https://docs.redpanda.com/streaming/current/manage/cluster-maintenance/compaction-settings/) and [consumer offsets](https://docs.redpanda.com/streaming/current/develop/consume-data/consumer-offsets/).

**In production:** The board on `game.leaderboard` is the source of truth for every reader, and the dashboard's in-memory map is enough to serve a top 10. When you need per-player rank queries at scale ("where is p014?"), serve them from Redis or another key-value store that is itself just one more consumer of `game.leaderboard`, loaded from the start and kept current from the tail. Give the topic a `segment.ms` and `min.cleanable.dirty.ratio` sized for your write rate, and keep publishing absolute totals. See the Idempotency and delivery and Data retention rows in [Production considerations](https://docs.redpanda.com/solutions/multiplayer-gaming/#_production_considerations), and [compaction settings](https://docs.redpanda.com/streaming/current/manage/cluster-maintenance/compaction-settings/).

### 5. Persist the match history

**Rule:** Give each sink its own consumer group, and route every record it cannot process to a dead-letter topic with the error attached instead of stopping or dropping it.

**Adapt:** Find each consumer that writes the stream to a database; check whether it shares a consumer group with a latency-sensitive consumer and what happens to a record it cannot decode or insert.

Analysts want match history in a database, and that requirement should cost nothing in code and nothing in latency for the leaderboard. Redpanda Connect meets both: the pipeline is configuration, and its consumer group `connect-history` reads at Postgres speed while the leaderboard group reads at broker speed.

The `mapping` flattens the Protobuf `oneof` into two row shapes, one per table, because a relational table wants columns, not a nested `scoreChanged` object. `match_started` records are dropped (`root = deleted()`): the history table is about finished matches, and the `match_ended` event carries the start time. Both inserts end with `ON CONFLICT DO NOTHING` on the event's natural key, so a redelivered record (Connect is at-least-once, like the Go services) inserts nothing twice.

The dead-letter path exists because a stream will, eventually, carry a record the pipeline cannot process, and the pipeline should not stop and should not drop it. `try` marks a failed message instead of aborting the batch, `reject_errored` refuses to send marked messages to the database, and `fallback` hands them to the next output with the reason in `@fallback_error`.

**Depends on:** The `redpanda` input, `schema_registry_decode`, `sql_insert`, and `fallback` are built-in components that know the Confluent wire format and Schema Registry, so the pipeline needs no schema file and no code. The record header the producer set in [Produce player events](https://docs.redpanda.com/solutions/multiplayer-gaming/produce-player-events/), `event_type`, is available to Bloblang as `@event_type`, which is how the mapping knows the shape before it reads the payload. See [schema_registry_decode](https://docs.redpanda.com/connect/components/processors/schema_registry_decode/), [sql_insert](https://docs.redpanda.com/connect/components/outputs/sql_insert/), and [error_handling](https://docs.redpanda.com/connect/configuration/error_handling/).

**In production:** Alert on growth of `game.player-events.dlq`, keep its records long enough to replay them after a fix, and run the pipeline with metrics exported so lag and errors are graphed alongside the brokers'. See the Dead-letter handling and Observability rows in [Production considerations](https://docs.redpanda.com/solutions/multiplayer-gaming/#_production_considerations).

### 6. Detect achievements

**Rule:** Keep per-entity state in the consumer only when the input topic is keyed by that entity, drop the state of revoked partitions on a rebalance, and judge time by the event's timestamp, not the wall clock.

**Adapt:** Find stateful consumers that read or write a shared store on every event; check the input topic's key, what they do when a partition is revoked, and which clock their rules read.

Three rules: `hot_streak` (three positive score changes within 30 seconds), `first_win` (once), and `veteran` (ten matches finished). All three need history for one player: the last few deltas with their times, a win counter, a match counter. The obvious place for that history is a shared store, and the obvious cost is a round trip per event plus a consistency story.

The service keeps the state in memory instead. It can, because [Create the topics](https://docs.redpanda.com/solutions/multiplayer-gaming/create-topics/) keyed `game.player-events` by `player_id`: every event of one player is on one partition, in order, and a partition is consumed by exactly one member of the group at a time. So the instance that owns the partition sees the player's complete history and nothing another instance needs. When a rebalance moves a partition, the service drops the state of that partition's players; the new owner rebuilds it from its committed offset onward.

The rules judge time by the event's `occurred_at`, not the wall clock. That is what makes the replay in [Scale and replay](https://docs.redpanda.com/solutions/multiplayer-gaming/scale-and-replay/) produce the same unlocks, and it is the right choice for any rule that measures game time rather than wall-clock time.

`veteran` counts `player_left` events, one of which the simulator emits per participant when a match ends. That keeps the rule inside the player's own partition; counting `match_ended` on `game.match-events` would need the participants' state from a different topic and key.

**Depends on:** Two consumer groups on one topic cost one extra read of the log and nothing on the producer side. The achievements service also produces, with the same idempotent settings as the simulator, and commits its input offsets only after the output produce is acknowledged, so a crash replays at most one batch. See [consumer offsets](https://docs.redpanda.com/streaming/current/develop/consume-data/consumer-offsets/) and [configure producers](https://docs.redpanda.com/streaming/current/develop/produce-data/configure-producers/).

**In production:** Give a stateful consumer a static group instance ID so a restart keeps its partitions instead of triggering a rebalance, and size partitions for the parallelism you need. See the Consumer scaling row in [Production considerations](https://docs.redpanda.com/solutions/multiplayer-gaming/#_production_considerations).

### 7. Scale and replay

**Rule:** Treat the source topic as the truth: retain it for the replay window you need, add consumer instances when lag keeps growing (never more than the partition count), and rebuild a view by seeking its group to the start.

**Adapt:** Find how consumers are scaled and how a lost or wrong view is rebuilt today; check source-topic retention against the replay window and whether instance counts can exceed the partition count.

The burst is a match-night peak in miniature: for a few seconds players generate more events than one leaderboard instance applies, and the board has to fall behind and catch up on its own rather than drop scores. Lag, the distance between the newest record and the last one a group committed, is how you see that happen. It is the one number to alert on for any consumer, and the dashboard reads it from the same source `rpk group describe` does.

When catching up is not fast enough, you add instances. Nobody told the new instances which partitions to take; joining the group is enough. The coordinator ran a rebalance and each member got two of six partitions. The ceiling is six instances, which is why [Create the topics](https://docs.redpanda.com/solutions/multiplayer-gaming/create-topics/) chose six partitions. A new owner does not start from zero: its first record on a partition arrives with a committed offset, so it loads that partition's players from `game.leaderboard`, the totals as of the offsets written into each entry, and continues from there. Three writers publishing totals for disjoint sets of players never contend.

The replay is the reason to build on a log at all. The board on `game.leaderboard` was never the source of truth; `game.player-events` is. Seeking the group to the start makes every instance recompute every total from the first record and publish each one again. The compacted topic absorbs thousands of superseded entries and converges, within a minute or two, back to one record per player, with the same scores it held before. The same move fixes a bug in the leaderboard logic (deploy the fix, seek, replay), bootstraps a new consumer that needs history, or rebuilds a view that was lost.

**Depends on:** Consumer group offsets are the consumer's, not the broker's, and `rpk group seek` edits them. Retention on `game.player-events` (7 days here, longer with Tiered Storage) decides how far back a replay can go. Compaction on `game.leaderboard` means the replay costs nothing lasting: the extra records are gone after the next compaction pass. Cooperative rebalancing moves only the partitions that need to move, so two instances keep working while the third joins. See [rpk group seek](https://docs.redpanda.com/streaming/current/reference/rpk/rpk-group/rpk-group-seek/), [consumer offsets](https://docs.redpanda.com/streaming/current/develop/consume-data/consumer-offsets/), and [compaction settings](https://docs.redpanda.com/streaming/current/manage/cluster-maintenance/compaction-settings/).

**In production:** Scale consumer groups on lag, keep instance counts at or below the partition count, and use Tiered Storage so the replay window is a retention setting rather than a disk size. Give `game.leaderboard` a `segment.ms` and dirty ratio suited to its write rate; the 60-second segments here exist so you can watch compaction happen. See the Consumer scaling and Data retention rows in [Production considerations](https://docs.redpanda.com/solutions/multiplayer-gaming/#_production_considerations).

### 8. Verify end to end

**Rule:** Prove the system by checking that independent consumers of one stream agree with each other, using numbers observable from outside the services: high watermarks, group lag, and sink counts.

**Adapt:** Find the existing end-to-end tests and alerts; check whether any compares one consumer's output with another's, or whether each only reads a service's own counters.

Every step's Verify section checked one component. This step checks that the components agree with each other, which is the claim the architecture actually makes: three consumers of one stream, three views of one truth. The board on `game.leaderboard`, reduced to the last record per key the way compaction reduces it, is compared with a `SUM(delta)` in Postgres that a different consumer wrote through a different path, and with what the dashboard serves; the match history is compared with the simulator's own count; the achievements topic's high watermark is compared with the service's counter; the dead-letter topic must hold exactly the poison records and nothing else.

The checks work because the simulator is deterministic and stops at a cap, so the number of `match_ended` events is a fact, not an estimate. They tolerate the two things you did in [Scale and replay](https://docs.redpanda.com/solutions/multiplayer-gaming/scale-and-replay/): a burst (the watermark check uses the simulator's acknowledged counts, and the seeded 3000 must still be exact when no burst happened) and a poison record (the dead-letter check expects exactly as many records as were poisoned).

**Depends on:** Every number the script needs is observable from outside: high watermarks and group lag from `rpk`, counts from the sinks, counters from the services. That is the property that makes a streaming system testable in CI, and it is the same property you would alert on in production. See [rpk group describe](https://docs.redpanda.com/streaming/current/reference/rpk/rpk-group/rpk-group-describe/).

**In production:** Turn these assertions into alerts: consumer lag per group, dead-letter topic size, and a periodic reconciliation between the board on `game.leaderboard` and the database. See the Observability row in [Production considerations](https://docs.redpanda.com/solutions/multiplayer-gaming/#_production_considerations).
