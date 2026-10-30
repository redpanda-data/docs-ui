# courier-tracker

Tracks courier deliveries for the dispatch app. The mobile app posts status
updates (picked up, en route, delivered, failed) to the API gateway, which
calls `courier.producer` to publish them to Kafka. Two consumers read the
stream:

- `courier.tracker` keeps per-courier delivery counts and writes them to
  Postgres for the ops dashboard.
- `courier.notifier` sends a customer notification when an order is delivered
  or fails.

## Run it locally

```
docker compose up -d
./scripts/create_topics.sh
pip install -r requirements.txt
python -m courier.tracker &
python -m courier.notifier &
python -m courier.producer --demo
```

## Production

Production runs on a three-broker Kafka 3.6 cluster on EC2 that the platform
team manages. Peak load is about 1,500 status updates a second on weekday
evenings. Connection settings come from environment variables (see
`courier/settings.py`).
