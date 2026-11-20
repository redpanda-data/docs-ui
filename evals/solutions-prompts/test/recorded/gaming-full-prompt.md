I've read the companion and every file in the repo. Before the details, one thing changes the whole plan: **this repo doesn't run on Redpanda today.** `README.md:26` says production is "a three-broker Kafka 3.6 cluster on EC2", and `docker-compose.yml:3` runs `apache/kafka:3.7.0` locally. It's also a courier-delivery tracker, not a game, so I've mapped the design onto it: the per-courier delivery count plays the leaderboard's role and the notifier is the second consumer.

## Step 1: Companion
I downloaded it in full with curl, and its header reads "Generated from the multiplayer-gaming solution (**v1.0.0**)". The docs MCP server isn't connected. I'll use `llms.txt` and the `.md` docs pages once I know your platform, because the product details depend on it.

## Step 2: What's in the repo
- **Language and client:** Python 3.12 with `confluent-kafka==2.4.0`, which is built on librdkafka. Postgres is accessed with `psycopg` 3.
- **Producer:** `courier/producer.py`, called by the API gateway. It writes JSON keyed by `order_id`.
- **Consumers:** `courier/tracker.py` (per-courier counts to Postgres and `courier-stats`) and `courier/notifier.py`.
- **Topics:** `config/topics.yaml` defines `delivery-status` (3 partitions, RF 1, 1 day retention) and `courier-stats` (3 partitions, RF 1, `delete`). `scripts/create_topics.sh` creates them.
- **Schemas:** there's no Schema Registry. Events are a plain JSON dataclass in `courier/events.py`.
- **Deployment:** `Dockerfile` runs only the tracker, and nothing deploys the notifier. Production deployment config isn't in this repo; per the README, a platform team manages it.
- **CI:** `.github/workflows/ci.yml` runs pytest (two serialization unit tests) and a docker build.

**There's a live bug, separate from the design:** `tracker.py:13` and `notifier.py:13` both use `group.id: courier-services` on the same topic. They split the partitions between them, so the tracker misses the deliveries that land on the notifier's partitions, and the notifier misses notifications on the tracker's partitions.

## Step 3: Questions I can't answer from the repo
1. **Platform:** are you moving off Kafka 3.6 on EC2 to Redpanda? If so, which deployment (Cloud BYOC, Dedicated, Serverless, Self-Managed or Kubernetes), and in which AWS region relative to the services? If you're staying on Kafka, Rules 3 and 8 and several Production gaps change: you'd need a separate Schema Registry, and Redpanda's schema ID validation, Tiered Storage and Shadowing wouldn't apply.
2. **Throughput:** is the README's peak of 1,500 updates a second still right? I also need the average record size, the most instances you'd ever run in one consumer group, and roughly how many couriers there are (that sets state restore time).
3. **Retention:** how far back must you be able to rebuild the counts? Today `delivery-status` keeps 1 day (`retention.ms: 86400000`). How long should the dead-letter topic be kept?
4. **Security:** TLS on every listener? Which authentication (SASL/SCRAM, mTLS or something else)? Should each service get its own principal and ACLs?
5. **Keying:** can an order be reassigned to a different courier mid-delivery? This decides between keying `delivery-status` by `courier_id` and adding a repartition topic.
6. **Producers:** is `courier/producer.py` the only writer to `delivery-status`, or do other services or languages write to it too?
7. **Schema format:** keep JSON and register a JSON Schema, or move to Protobuf or Avro? Is there an existing registry?
8. **Notifier:** is a duplicate customer notification acceptable after a crash? Is `auto.offset.reset: latest` intentional, so that a new group never notifies old orders?
9. **Postgres:** may the `courier_stats` table get extra columns (source partition and offset)? Who else reads it?

## Step 4: Adapt answers
| Rule | What I found |
|---|---|
| 1 | `docker-compose.yml:15` has `KAFKA_AUTO_CREATE_TOPICS_ENABLE: "true"`, so the producer's first send creates `delivery-status` with broker defaults. None of the three services checks for its topic at startup. `tracker.py:24` also creates its own table (`CREATE TABLE IF NOT EXISTS`). Nothing waits and logs what it's waiting for. |
| 2 | The producer keys by `order_id` (`producer.py:20`), but the tracker keeps state per `courier_id` (`tracker.py:33`). **They don't match**, so one courier's events spread across partitions and instances. Each topic has 3 partitions, and the largest group size is unknown (question 2). |
| 3 | `events.py:18-27` serializes JSON by hand. There's no registry, no subject and no compatibility level. |
| 4 | `producer.py:11-15` sets `acks: "1"` and doesn't set idempotence. It uses librdkafka's default partitioner, which per the companion (Design contract §4) is CRC32 rather than murmur2. It has no delivery callback and never flushes, so send errors are invisible. The tracker's `stats_producer` (`tracker.py:17`) has the same issues. |
| 5 | The tracker publishes deltas (`{"delta": 1}`, `tracker.py:39`) without a key to a `delete`-policy topic, and increments Postgres by `+1` (`tracker.py:36`). It auto-commits (`tracker.py:15`) whether or not the output was acknowledged. A redelivery double-counts, and the in-memory `counts` dict starts empty after every restart. |
| 6 | The Postgres write sits inside the tracker and shares group `courier-services` with the notifier, which is the latency-sensitive consumer. A bad record **crashes the tracker** (`tracker.py:30` has no try/except), and the notifier **drops** it with a log line (`notifier.py:31-33`). There's no dead-letter topic. |
| 7 | The tracker keeps per-courier state while its input is keyed by order, has no load on partition assignment, and saves nothing it can restore. No rule depends on time; `ts` is event time, set when the event is serialized (`events.py:22`). The notifier is stateless. |
| 8 | There's no scaling config, and the instance count is unbounded and undocumented. Counts can't be rebuilt: Postgres holds increments and `courier-stats` holds deltas. `auto.offset.reset: latest` means a new group can't replay. Retention is 1 day, and whether that covers the replay window is question 3. |
| 9 | Only the unit tests in `tests/test_events.py`. There's no end-to-end test and no alerts, and nothing compares one consumer's output with another's. |

## Step 5: Draft plan
Citations: "DC §n" is the companion's Design contract section n, and "PG" is its Production gaps. Items marked ⟂ depend on your answers.

**Rule 1: wait, don't create** (DC §1)
- Turn off auto-create in `docker-compose.yml`.
- Add a `wait_for_topics()` helper in a new `courier/kafka.py`. It polls `list_topics()` and logs which topics are missing; producer, tracker and notifier call it before they start.
- Move the table DDL out of `tracker.py` into a migration (`db/001_courier_stats.sql`).
- Wait for the schema subject too, once Rule 3 lands.

**Rule 2: key by the state's entity, enough partitions** (DC §2, PG Partitions)
- ⟂ (question 5) If an order never changes courier, key `delivery-status` by `courier_id`. Otherwise, the tracker re-keys into a new topic keyed by `courier_id` and aggregates from that.
- Set the partition count in `config/topics.yaml` from your largest planned group (question 2) and the sizing guide. I won't pick a number.
- RF 3 in production (PG Brokers and replication).
- A changed key or partitioner remaps existing keys, which breaks per-key order. So the cutover writes to a **new** topic (or the new cluster) rather than changing the live one (DC §2, "Other ways").

**Rule 3: registered schema, producers look it up** (DC §3, PG Schema validation)
- ⟂ (questions 1 and 7) Register the schema under the subject `delivery-status-value` (and `courier-stats-value`) with `BACKWARD` compatibility. A script in `scripts/` does this from the deploy pipeline.
- The producer uses the registry serializer with auto-register off and waits for the subject.
- On Redpanda, turn on server-side schema ID validation. On Kafka that feature doesn't exist, so I'll tell you what your registry offers instead.

**Rule 4: idempotent, `acks=all`, Java-compatible hashing** (DC §4)
- In `producer.py` and the tracker's producer: `enable.idempotence: true`, `acks: all`, `partitioner: murmur2_random` (the setting the companion names for librdkafka clients), plus a delivery callback and a flush on shutdown.
- On Kafka, `acks=all` is only as durable as the topic's `min.insync.replicas`, so look that value up for your cluster. I won't assume it.

**Rule 5: publish totals, compacted, offset-stamped, commit after the ack** (DC §5, PG Compaction, PG Idempotency)
- The tracker publishes `{courier_id, delivered, source_partition, source_offset}` keyed by `courier_id` to `courier-stats`, which becomes `cleanup.policy: compact`.
- It turns off auto-commit and commits only after the output's delivery reports succeed.
- It skips any record at or below the stored offset.
- ⟂ `segment.ms` and `min.cleanable.dirty.ratio` depend on your write rate, so you'll look them up and set them. I won't make them up.

**Rule 6: own group per sink, DLQ with the error** (DC §6, PG Dead-letter handling)
- Separate groups: `courier-tracker`, `courier-notifier`, and a new `courier-stats-sink`.
- Move the Postgres write into its own sink that reads `courier-stats` and upserts the *absolute* total with a guard that only applies a newer offset. On Redpanda this can be a Redpanda Connect `sql_insert` pipeline (⟂ question 1); otherwise it's a small Python consumer.
- Add `delivery-status.dlq`. Every undecodable or unprocessable record goes there with its original key and headers plus an `error` header, in the tracker, the notifier and the sink.
- DLQ growth alert and retention: question 3.

**Rule 7: state only when keyed by it, saved, loaded on assign** (DC §7, PG Consumer state, PG Consumer scaling)
- **Applies to the tracker.** Its saved state *is* `courier-stats`, the same way the leaderboard reloads its own topic. In an `on_assign` callback it reads `courier-stats` from the start and loads the couriers on its partitions before it processes anything. If the restore fails, it exits. Add static membership (`group.instance.id`).
- **Doesn't apply to the notifier**, which keeps no state. If question 8 says duplicate notifications matter, notified-order state keyed by `order_id` (the topic key) brings it under this rule.
- Time rules don't apply: no rule reads a clock.

**Rule 8: source is the truth; replay into a new topic** (DC §8, PG Data retention, PG Sizing)
- ⟂ Set `delivery-status` retention to your replay window (question 3). On Redpanda, Tiered Storage can make that window a retention setting.
- The tracker uses `auto.offset.reset: earliest`. Its output topic and group become config (`STATS_TOPIC` already is; add `TRACKER_GROUP`), so a rebuild runs as `courier-tracker-v2` → `courier-stats.v2` and then readers switch.
- Document the instance cap (no more than the partition count), scaling on lag, and how to measure restore time, in a README runbook.

**Rule 9: consumers agree, measured from outside** (DC §9, PG Observability)
- Add `scripts/verify.py`, which checks four things:
  - The `delivered` count per courier, read straight from `delivery-status` with no group, equals the last-per-key `courier-stats`, which equals the Postgres `courier_stats` table.
  - Every group has zero lag, using high watermarks and committed offsets from the admin API.
  - The DLQ holds exactly the injected poison records.
  - Every record the producer acknowledged is on the log.
- A CI job runs it against docker compose.
- Production alerts: lag per group, DLQ size, and a periodic reconciliation between `courier-stats` and Postgres.

**Production gaps that apply:**
- Brokers and replication: RF 3.
- Client placement: run in the cluster's region (question 1).
- Security: question 4. Add TLS/SASL settings to `settings.py` from environment variables.
- Partitions, compaction, sizing, data retention, idempotency, dead-letter handling and observability: covered in the rules above.
- Disaster recovery (Shadowing) and Analytics (Iceberg) only apply on Redpanda and are optional. I'll list them, not build them.

**Proposed commits:**
1. Separate consumer groups (fixes the live bug)
2. Producer settings for idempotence, acks, partitioner and delivery reports
3. Wait-for-topics, auto-create off, DDL moved to a migration
4. Topic config: compaction, DLQ, RF and retention placeholders for your values
5. Tracker publishes offset-stamped totals, commits after the ack and restores on assign
6. Postgres sink as its own consumer
7. DLQ routing
8. Schema Registry
9. Re-keying and new-topic cutover
10. `verify.py` and the CI end-to-end job
11. README runbook

I'm stopping here. Once you answer the questions and approve the plan, I'll replace each ⟂ item with a concrete step and cite the docs pages for your platform before I change anything.