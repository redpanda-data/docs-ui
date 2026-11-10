import os

BOOTSTRAP_SERVERS = os.environ.get("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
STATUS_TOPIC = os.environ.get("STATUS_TOPIC", "delivery-status")
STATS_TOPIC = os.environ.get("STATS_TOPIC", "courier-stats")
DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://courier:courier@localhost:5432/courier")
