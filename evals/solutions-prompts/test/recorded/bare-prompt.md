I've hardened the code for production, but I couldn't run the tests or the stack because shell access is denied in this session. Please run `pytest -q` and the local `docker compose` flow before you merge. Nothing is committed.

I read "Redpanda best practices" as Kafka-API client and topic practices, which apply the same way on Redpanda. The README says production runs on Kafka 3.6, managed by the platform team, so I didn't change any brokers. **If you're actually moving to Redpanda**, tell me and I'll switch local dev to Redpanda and use `rpk` for topics.

## Bugs that matter most

- **Each consumer was only getting part of the data.** The tracker and notifier used the same consumer group (`courier-services`), so the broker split the 3 partitions between them. Each one only saw some of the updates. Customers were missing notifications, and the delivery counts in Postgres are too low. Each now has its own group (`courier-tracker`, `courier-notifier`), set by environment variable.
- **The producer could lose or duplicate updates.** It used `acks=1` without idempotence, so a broker failover could drop updates or reorder retries. It now uses `acks=all` with idempotence, so updates stay in order per order, plus lz4 compression. It also retries when its local queue is full, logs failed deliveries, and flushes before exiting.
- **The tracker double-counted or skipped deliveries.** Offsets were committed automatically, separately from the Postgres write, so a crash or rebalance could do either. The tracker now saves each partition's position in a new Postgres table (`tracker_offsets`), in the same transaction as the count. A replayed message is detected and skipped. Offsets are now committed to Kafka only after a message is fully processed, in both consumers.
- **One bad message would crash the tracker in a loop.** It now logs and skips it, as the notifier already did.

## Other changes

- **Topics (`config/topics.yaml`):** replication factor 3 and `min.insync.replicas=2`, up from 1. `create_topics.sh` scales this down for the single local broker and now applies the topic configs, which it used to ignore.
- **Startup position:** the tracker starts from the oldest retained data when it has no saved position. The notifier deliberately starts from new messages, so it never re-notifies customers about old orders.
- **Shutdown:** both consumers handle SIGTERM by leaving the group and committing.
- **Security:** settings for TLS and SASL/SCRAM come from environment variables. The README lists them.
- **Other:** auto topic creation is off locally, to match production. The container runs as a non-root user. Stats messages are now keyed by courier. I added `tests/test_settings.py`.

## ⚠️ Before the first deploy

Because the group names changed, the new tracker group has no saved position. It will re-read the whole 24h of retained data and add it on top of the existing counts. Those counts are already wrong because of the shared-group bug, so the cleanest path is:
1. Stop the old tracker.
2. Empty `courier_stats`.
3. Deploy, so the tracker rebuilds counts from the retained 24h. Anything older needs a separate backfill.

Alternatively, copy the old group's offsets to `courier-tracker` with `kafka-consumer-groups.sh --reset-offsets` before you deploy.

## Decisions for you

- **Retention:** `delivery-status` keeps only 24h. A consumer that's down over a weekend would lose data for good. 3–7 days is safer, at roughly 20 GB/day before replication.
- **Partitions:** 3 caps each service at 3 instances. That's enough for 1,500 updates/s, but adding partitions later briefly breaks per-order ordering, so decide before launch.
- **Stats gap:** if the tracker crashes between the Postgres commit and publishing to `courier-stats`, that stats message is lost (Postgres is still correct). Fixing this means publishing totals on a compacted topic, which would change the message format for whoever reads `courier-stats`.