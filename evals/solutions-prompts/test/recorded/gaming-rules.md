# Agent companion: Keep a live leaderboard current as game events stream in

Generated from the multiplayer-gaming solution (v1.0.0). Human guide: https://docs.redpanda.com/solutions/multiplayer-gaming/
## Rules

Every rule must hold in the target system.

1. Start every service before its topic and schema exist, and have it poll and log what it is waiting for, instead of exiting or creating what is missing. (from [Start the environment](https://docs.redpanda.com/solutions/multiplayer-gaming/start-environment/))
2. Key every event by the entity a consumer keeps state for, and give each topic at least as many partitions as the largest consumer group will run instances. (from [Create the topics](https://docs.redpanda.com/solutions/multiplayer-gaming/create-topics/))
3. Register each topic's schema under the `<topic>-value` subject with `BACKWARD` compatibility before anything produces, and make producers look the schema up and wait for it, never register it. (from [Register the schemas](https://docs.redpanda.com/solutions/multiplayer-gaming/register-schemas/))
4. Produce with idempotence on, `acks=all`, and a partitioner that hashes keys the way the Java client does, so a retry is never applied twice and one key reaches one partition from any client. (from [Produce the player events](https://docs.redpanda.com/solutions/multiplayer-gaming/produce-player-events/))
5. Publish absolute state, never deltas, to a compacted topic keyed by the entity, record in each entry the source offset it was computed from, and commit input offsets only after the output is acknowledged. (from [Build the live leaderboard](https://docs.redpanda.com/solutions/multiplayer-gaming/build-leaderboard/))
6. Give each sink its own consumer group, and route every record it cannot process to a dead-letter topic with the error attached instead of stopping or dropping it. (from [Persist the match history](https://docs.redpanda.com/solutions/multiplayer-gaming/persist-match-history/))
7. Keep per-entity state in the consumer only when the input topic is keyed by that entity, save it to a compacted topic with the source offset it covers, load it when a partition is assigned, and judge time by the event's timestamp, not the wall clock. (from [Detect the achievements](https://docs.redpanda.com/solutions/multiplayer-gaming/detect-achievements/))
8. Treat the source topic as the truth: retain it for the replay window you need, add consumer instances when lag keeps growing (never more than the partition count), and rebuild a view by replaying into a new topic in a new group, then switching readers to it. (from [Scale, restart, and replay the consumers](https://docs.redpanda.com/solutions/multiplayer-gaming/scale-and-replay/))
9. Prove the system by checking that independent consumers of one stream agree with each other, using numbers observable from outside the services: high watermarks, group lag, and sink counts. (from [Verify the system end to end](https://docs.redpanda.com/solutions/multiplayer-gaming/verify-end-to-end/))

