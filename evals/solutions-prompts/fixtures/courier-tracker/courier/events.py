"""Delivery status events, serialized as JSON."""
import json
import time
from dataclasses import asdict, dataclass

STATUSES = ("picked_up", "en_route", "delivered", "failed")


@dataclass
class StatusUpdate:
    order_id: str
    courier_id: str
    status: str
    lat: float
    lon: float
    ts: float = 0.0

    def to_bytes(self) -> bytes:
        if self.status not in STATUSES:
            raise ValueError(f"unknown status {self.status}")
        data = asdict(self)
        data["ts"] = self.ts or time.time()
        return json.dumps(data).encode()

    @classmethod
    def from_bytes(cls, raw: bytes) -> "StatusUpdate":
        return cls(**json.loads(raw))
