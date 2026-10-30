"""Count deliveries per courier and keep the totals in Postgres."""
import json
from collections import defaultdict

import psycopg
from confluent_kafka import Consumer, Producer

from courier import settings
from courier.events import StatusUpdate

consumer = Consumer({
    "bootstrap.servers": settings.BOOTSTRAP_SERVERS,
    "group.id": "courier-services",
    "auto.offset.reset": "latest",
    "enable.auto.commit": True,
})
stats_producer = Producer({"bootstrap.servers": settings.BOOTSTRAP_SERVERS})

counts = defaultdict(int)


def main() -> None:
    db = psycopg.connect(settings.DATABASE_URL, autocommit=True)
    db.execute("CREATE TABLE IF NOT EXISTS courier_stats (courier_id text PRIMARY KEY, delivered int)")
    consumer.subscribe([settings.STATUS_TOPIC])
    while True:
        msg = consumer.poll(1.0)
        if msg is None or msg.error():
            continue
        update = StatusUpdate.from_bytes(msg.value())
        if update.status != "delivered":
            continue
        counts[update.courier_id] += 1
        db.execute(
            "INSERT INTO courier_stats VALUES (%s, 1) "
            "ON CONFLICT (courier_id) DO UPDATE SET delivered = courier_stats.delivered + 1",
            (update.courier_id,),
        )
        stats_producer.produce(settings.STATS_TOPIC, value=json.dumps({"courier_id": update.courier_id, "delta": 1}))


if __name__ == "__main__":
    main()
