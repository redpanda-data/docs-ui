#!/usr/bin/env bash
# Create the topics in config/topics.yaml on the local Kafka container.
set -euo pipefail

python3 - <<'PY' | while read -r name parts rf; do
import yaml
for t in yaml.safe_load(open("config/topics.yaml"))["topics"]:
    print(t["name"], t["partitions"], t["replication_factor"])
PY
  docker compose exec -T kafka /opt/kafka/bin/kafka-topics.sh \
    --bootstrap-server localhost:9092 --create --if-not-exists \
    --topic "$name" --partitions "$parts" --replication-factor "$rf"
done
