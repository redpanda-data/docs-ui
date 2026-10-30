"""Tell the customer when an order is delivered or fails."""
import logging

from confluent_kafka import Consumer

from courier import settings
from courier.events import StatusUpdate

log = logging.getLogger("notifier")

consumer = Consumer({
    "bootstrap.servers": settings.BOOTSTRAP_SERVERS,
    "group.id": "courier-services",
    "auto.offset.reset": "latest",
})


def notify(update: StatusUpdate) -> None:
    log.info("order %s is %s", update.order_id, update.status)


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    consumer.subscribe([settings.STATUS_TOPIC])
    while True:
        msg = consumer.poll(1.0)
        if msg is None or msg.error():
            continue
        try:
            update = StatusUpdate.from_bytes(msg.value())
        except Exception:
            log.warning("skipping bad message at offset %s", msg.offset())
            continue
        if update.status in ("delivered", "failed"):
            notify(update)


if __name__ == "__main__":
    main()
