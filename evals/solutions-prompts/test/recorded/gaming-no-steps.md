I've audited this repo against the companion's nine rules and fixed the problems that were clearly safe to fix. Nothing has been tested or committed: shell access was denied in this session, so I couldn't run `pytest` or the stack. Run `pytest -q` and a local `docker compose` pass before you trust the changes.

One thing first: your production is the platform team's three-broker **Kafka 3.6** cluster, not Redpanda. Redpanda's docs don't describe that broker, and the docs MCP server isn't connected anyway. So I used the design's reasoning and only Kafka client and broker settings, with no Redpanda-specific features.

## What was wrong and what I changed

| Rule | What I found | Change |
|---|---|---|
| 6 | The tracker and notifier shared the `courier-services` group, so they split the partitions. Some customers got no notification and some deliveries were never counted. | Separate groups `courier-tracker` and `courier-notifier` (`settings.py`). Bad records now go to `delivery-status.dlq`, keeping their key and headers and adding `error` and source-offset headers (`streams.py`). Before, the tracker crashed on a bad record and the notifier dropped it. |
| 1 | The broker auto-created topics, and `create_topics.sh` silently ignored the `config:` block, so `retention.ms` and `cleanup.policy` were never applied. | All services now wait for their topics and log what's missing. Compose has auto-create off. The script applies the configs. |
| 4 | `acks=1`, no idempotence, librdkafka's default CRC32 partitioner, and failed sends were never reported. | `enable.idempotence`, `acks=all` and `partitioner=murmur2_random`. Failed sends are logged, and the demo flushes on exit. |
| 5 | Auto-commit, `delivered + 1` on every record, and unkeyed `{"delta": 1}` records. A redelivered record was counted twice. | A `deliveries` table with primary key `order_id`. The total only goes up when that row is new. Absolute totals are published, keyed by courier, to a new compacted topic `courier-totals`. Offsets are committed only after the DB write and the publish are acknowledged. |
| 9 | Only round-trip unit tests. | Tests for the producer config, dead-letter headers, and rejecting an unknown status on read. These are still not the cross-consumer checks the rule asks for (see the last open item). |

## Before you deploy
- **The consumer-group switch.** The new groups have no committed offsets, so they start at the end of the topic and skip anything produced during the switch. Copy the old group's offsets into both new groups first. The README now has the steps. Don't start the notifier from the beginning of the topic: it would re-notify customers about old orders.
- **A behavior change.** An order that reports "delivered" twice now counts once.
- **Retired topic.** Nothing in this repo writes `courier-stats` any more. If something outside the repo reads it, that reader needs to move to `courier-totals`.

## Open items
1. **Message key (Rules 2, 5, 7).** The topic is keyed by `order_id`, but the tracker's state is per courier. Postgres is correct as it is. But with more than one tracker instance, two of them could publish one courier's total out of order. Also, no single source offset covers a whole courier total. If an order always stays with one courier, keying by `courier_id` fixes both, at the cost of the per-order ordering the original comment protects. Which do you want?
2. **Schema Registry (Rule 3).** Events are plain JSON with no registry. Your Kafka cluster has no built-in registry, so this needs a decision: run a separate one, or move to Redpanda, which has one built in.
3. **Values to look up; I didn't guess any of them:**
   - Retention, partitions and replication factor of the production topics: run `kafka-configs.sh --describe` and `kafka-topics.sh --describe` against the cluster.
   - Whether `auto.create.topics.enable` is on in production.
   - How many instances each service runs, compared with `delivery-status`'s 3 partitions.
   - Whether anything outside the repo publishes to `delivery-status`, and which partitioner it uses.
4. **Rebuilding the view (Rule 8).** `courier_stats` holds totals from before the retention window, so the topic can't rebuild them. To make replay possible, you need to choose a retention period, and the tracker needs a configurable output table so a rebuild can go to a new table in a new group.
5. **Duplicate notifications.** The notifier is now at-least-once, so a crash can send a notification twice. Fixing that needs per-order "already notified" state.
6. **Cross-consumer checks (Rule 9).** Add a check comparing `courier-totals`, reduced to the latest record per courier, with `courier_stats`. Add alerts on per-group lag and on the dead-letter topic growing.