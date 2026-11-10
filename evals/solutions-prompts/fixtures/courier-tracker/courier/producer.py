"""Publish delivery status updates."""
import argparse
import random
import time

from confluent_kafka import Producer

from courier import settings
from courier.events import STATUSES, StatusUpdate

producer = Producer({
    "bootstrap.servers": settings.BOOTSTRAP_SERVERS,
    "acks": "1",
    "linger.ms": 5,
})


def publish(update: StatusUpdate) -> None:
    # Keyed by order so all updates for one order stay in order.
    producer.produce(settings.STATUS_TOPIC, key=update.order_id, value=update.to_bytes())
    producer.poll(0)


def demo() -> None:
    couriers = [f"c-{i}" for i in range(10)]
    while True:
        publish(StatusUpdate(
            order_id=f"o-{random.randint(1, 5000)}",
            courier_id=random.choice(couriers),
            status=random.choice(STATUSES),
            lat=52.5 + random.random() / 10,
            lon=13.4 + random.random() / 10,
        ))
        time.sleep(0.01)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--demo", action="store_true")
    if parser.parse_args().demo:
        demo()
