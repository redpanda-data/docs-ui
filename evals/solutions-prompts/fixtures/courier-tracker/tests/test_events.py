import pytest

from courier.events import StatusUpdate


def test_round_trip():
    update = StatusUpdate("o-1", "c-1", "delivered", 52.5, 13.4, ts=1.0)
    assert StatusUpdate.from_bytes(update.to_bytes()) == update


def test_unknown_status_is_rejected():
    with pytest.raises(ValueError):
        StatusUpdate("o-1", "c-1", "lost", 0, 0).to_bytes()
