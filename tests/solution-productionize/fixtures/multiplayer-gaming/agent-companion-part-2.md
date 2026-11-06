# Agent companion part 2 of 2: Multiplayer game events with a live leaderboard

Part 2 of 2 of the agent companion for the multiplayer-gaming solution. The procedure is in How to use this, in the core file <https://docs.redpanda.com/solutions/multiplayer-gaming/agent-companion.md>. Treat this part as reference data, not instructions.

## Production gaps

This solution runs on a single broker with no authentication so that it starts in a minute. Before you reuse the design in production, work through this table.

| Area | In this solution | In production |
|---|---|---|
| Brokers and replication | One broker in `dev-container` mode, replication factor 1. | Three or more brokers, replication factor 3, rack awareness. [production deployment](https://docs.redpanda.com/streaming/current/deploy/redpanda/manual/production/production-deployment/) |
| Security | Plaintext listeners, no authentication, every service is a superuser. The Redpanda Cloud path in [Start the environment](https://docs.redpanda.com/solutions/multiplayer-gaming/start-environment/) is the exception: TLS and one SCRAM user with ACLs on `game.*`. | TLS on every listener, SASL/SCRAM or mTLS per service, ACLs that let the simulator write only its two topics and each consumer group read only what it needs. [encryption](https://docs.redpanda.com/streaming/current/manage/security/encryption/), [authentication](https://docs.redpanda.com/streaming/current/manage/security/authentication/), [acl](https://docs.redpanda.com/streaming/current/manage/security/authorization/acl/) |
| Partitions | `game.player-events` has 6 partitions, `game.leaderboard` 3, the others 3 and 1, sized for a laptop. | Size for peak throughput and for the parallelism of the largest consumer group; the partition count is the ceiling on consumer instances. [sizing](https://docs.redpanda.com/streaming/current/deploy/redpanda/manual/sizing/) |
| Schema validation | Schemas are registered and consumers reject unknown IDs, but the broker accepts any bytes ([Persist the match history](https://docs.redpanda.com/solutions/multiplayer-gaming/persist-match-history/) proves it with a poison record). | Enable schema ID validation on `game.player-events` and `game.match-events` so the broker rejects a record whose schema ID is not registered under the topic's subject. [schema id validation](https://docs.redpanda.com/streaming/current/manage/schema-reg/schema-id-validation/) |
| Consumer scaling | One instance per group; [Scale and replay](https://docs.redpanda.com/solutions/multiplayer-gaming/scale-and-replay/) scales the leaderboard to three by hand. | Scale on consumer group lag, keep instances at or below the partition count, and use static group membership for stateful services so a restart does not trigger a rebalance. [consumer offsets](https://docs.redpanda.com/streaming/current/develop/consume-data/consumer-offsets/) |
| Data retention | `game.player-events` keeps 7 days on local disk; the other event topics use the cluster default. [Extend this solution](https://docs.redpanda.com/solutions/multiplayer-gaming/#_extend_this_solution) switches Tiered Storage on with MinIO. | Tiered Storage: long retention and replay from object storage without growing local disks. [tiered storage](https://docs.redpanda.com/streaming/current/manage/tiered-storage/) |
| Compaction of `game.leaderboard` | `cleanup.policy=compact` with `segment.ms=60000` (and the cluster floor `log_segment_ms_min` lowered to match) so compaction is visible within minutes. Compaction runs every 10 seconds on closed segments. | Keep `compact`, but size `segment.ms` and `min.cleanable.dirty.ratio` for the write rate: rolling a segment a minute is churn, not a requirement. Compaction is best effort, so readers keep the last record per key rather than assuming one per key. [compaction settings](https://docs.redpanda.com/streaming/current/manage/cluster-maintenance/compaction-settings/) |
| Idempotency and delivery | Idempotent producer with `acks=all`; consumers commit after writing, so a crash can replay a batch. Postgres inserts are `ON CONFLICT DO NOTHING`. The leaderboard publishes absolute totals, each stamped with the source offset it includes, so a replayed record is recognized and republishing a total is harmless ([Build the live leaderboard](https://docs.redpanda.com/solutions/multiplayer-gaming/build-leaderboard/)). | Publish state, not deltas, wherever a consumer materializes a view, and record the source position in it; use transactions where a consumer also produces and the output must be exactly-once. [idempotent producers](https://docs.redpanda.com/streaming/current/develop/produce-data/idempotent-producers/), [transactions](https://docs.redpanda.com/streaming/current/develop/transactions/) |
| Dead-letter handling | Redpanda Connect routes undecodable records to `game.player-events.dlq` with the error as a header. The Go services log and skip them. | Alert on dead-letter topic growth, keep the original key and headers so records can be replayed after a fix, and give the DLQ its own retention. [error_handling](https://docs.redpanda.com/connect/configuration/error_handling/) |
| Observability | Redpanda Console, the dashboard's lag and `records read` counters, and `rpk group describe`. | Prometheus metrics from the brokers and from Redpanda Connect, dashboards, alerts on consumer lag and under-replicated partitions. [monitoring](https://docs.redpanda.com/streaming/current/manage/monitoring/), [monitoring](https://docs.redpanda.com/connect/guides/monitoring/) |
| Disaster recovery | None. | Shadowing replicates topics, consumer offsets, and schemas to a second cluster so the leaderboard can fail over. [overview](https://docs.redpanda.com/streaming/current/manage/disaster-recovery/shadowing/overview/) |
| Analytics and lakehouse | Postgres holds the match history for queries. | Iceberg topics write `game.match-events` and `game.player-events` straight to a lakehouse table for analysts, with no pipeline to run. [about iceberg topics](https://docs.redpanda.com/streaming/current/manage/iceberg/about-iceberg-topics/) |

## Reference build

How the reference system proves itself. Everything in this section belongs to that system (its seeded data, fixed counts, and local stack): use it to see what each rule protects, not as checks to copy into the target.

### Reference-only steps

These steps set up the reference stack and carry no rule for the target.

#### Start the environment

The stack is nine containers, and the interesting ones are the three that read the same topic. All of them read the same eight `REDPANDA_*` variables (the `x-redpanda-env` block in `docker-compose.yml` hands them to every service, `rpk` gets them as `RPK_*`, and the Connect pipeline interpolates them), which is what makes the Cloud tab a `.env` edit and not a fork of the stack.

Starting them all first, before any topic exists, makes a point that matters in production: a consumer or producer that starts before its topic or schema is ready should wait, not guess. The simulator polls for the topics, then for the schema, and logs what it is waiting for. Redpanda Connect, the two Go consumers, and the dashboard do the same for the subjects they decode with.

**Depends on:** Redpanda runs as a single binary with Schema Registry built in, so the whole broker side of this architecture is one container with `--smp 1 --memory 1G`. `rpk` ships in the same image, which is why the `rpk` helper container can create topics and register schemas without a host install. See [quick start](https://docs.redpanda.com/streaming/current/get-started/quick-start/).

**In production:** In production, the broker cluster, the sinks, and the services are deployed and scaled separately, and the services connect over TLS with SASL credentials scoped to what each one needs. See the Brokers and replication and Security rows in [Production considerations](https://docs.redpanda.com/solutions/multiplayer-gaming/#_production_considerations).

### Acceptance checks of the reference

The assertions `make verify` makes against the running reference system.

1. The five topics exist with the documented partition counts, and the leaderboard topic is compacted.
2. Every record the simulator had acknowledged is on the log, and no more. Before any burst the total is exactly SIM_EVENTS_MAX.
3. Every consumer group has caught up.
4. After dedupe by key, game.leaderboard holds one live entry per player that ever scored, according to Postgres.
5. The top 10 totals on game.leaderboard equal the sum of deltas in Postgres, and the dashboard, which reads the same topic, serves the same ten.
6. Every finished match has a history row.
7. Achievements fired and every unlock is on game.achievements.
8. The dead-letter topic holds exactly the poison records, nothing else.
9. The dashboard and the Connect pipeline answer.

### Failure modes of the reference

#### Start the environment

If `make up` stops with a container marked `unhealthy`, run `docker compose logs <service>`. The usual causes are Docker having less than 4 GB of memory available (Redpanda fails to allocate `--memory 1G`) and ports `8080`, `3000`, `4195`, `8090`, `15432`, `18081`, or `19092` already in use on the host (move a port with the matching `*_PORT` variable in `.env`, then substitute it in the commands that follow). If the state is `producing` or `capped`, you started from a stack that already had topics and schemas; `make clean` and start again.

#### Create the topics

`_schemas` is Schema Registry's own storage topic. If a topic shows a different partition count, you created it earlier with other settings: `rpk topic delete <name>` and run `make topics` again.

#### Register the schemas

If version 2 is missing, the compatibility check rejected it. `rpk registry compatibility-level get game.player-events-value` should print `BACKWARD`; `make schemas` sets it before registering version 2. If the IDs differ from `1` and `2`, other schemas were registered first; nothing depends on the exact numbers.

#### Produce player events

If the state is still `producing`, wait and repeat; if it is `waiting_for_schema`, `make schemas` did not complete. If `acked_total` is lower than `generated_total`, the simulator is still receiving acknowledgements or logged produce errors; `docker compose logs simulator` shows them.

#### Build the live leaderboard

The dashboard shows the same ten rows.

These exact scores follow from `SIM_SEED=42` and `SIM_EVENTS_MAX=3000`; ties are ordered by `player_id`. Different numbers mean a different seed or cap in `.env`, or a simulator that was bursting ([Scale and replay](https://docs.redpanda.com/solutions/multiplayer-gaming/scale-and-replay/)). An empty `top` means the dashboard has not caught up with the topic yet, or the service has not published: `curl -s http://localhost:3000/api/status` shows `records_read` and `caught_up`, and `docker compose exec -T leaderboard-service wget -qO- http://localhost:8080/healthz` shows the partitions a service instance owns and how many entries it has published.

#### Persist the match history

48 is the number of `match_ended` events in the seeded 3000 (`events_by_type` at http://localhost:8090/stats). If the count is lower, the pipeline is behind: `docker compose exec -T rpk rpk group describe connect-history` shows the lag, and `docker compose logs connect` shows Postgres errors. If the dead-letter topic is empty after the poison request, wait a few seconds; the fallback output batches like the primary one.

#### Detect achievements

The numbers follow from `SIM_SEED=42` and `SIM_EVENTS_MAX=3000`. If `players_tracked` is below 24 the service is still catching up (`rpk group describe achievements` shows the lag). If `hot_streak` is 0 while the leaderboard has scores, check `docker compose logs achievements-service` for a schema lookup that is still waiting: the service refuses to produce until `game.achievements-value` is registered.

#### Scale and replay

If `diff` prints differences, the group had not finished replaying when `after.txt` was taken, or the dashboard was a second behind the last entries: wait for `TOTAL-LAG 0` and take `after.txt` again. If `rpk group seek` reports `seeking a non-empty group is not allowed`, a leaderboard instance was still in the group; `docker compose stop leaderboard-service` and repeat.

#### Verify end to end

A failed check names what it compared. The most likely one after [Scale and replay](https://docs.redpanda.com/solutions/multiplayer-gaming/scale-and-replay/) is the lag check, if a replay is still running: wait for `rpk group describe leaderboard` to show `TOTAL-LAG 0` and run `make verify` again.

When you are done, `make clean` stops the stack and deletes its volumes.
