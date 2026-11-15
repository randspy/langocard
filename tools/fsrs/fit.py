"""Fit the FSRS-6 model used by java-fsrs 1.0.0 from an offline backup."""
import argparse
from dataclasses import dataclass
from datetime import datetime, timezone
import json
from pathlib import Path
import random

MIN_REVIEWS = 1000
MIN_TRAINING_REVIEWS = 512
MAX_CARD_HISTORY = 64
RATINGS = {"AGAIN": 1, "HARD": 2, "GOOD": 3, "EASY": 4}


@dataclass(frozen=True)
class Review:
    key: str
    rating: int
    time: datetime
    duration: int


def extract(backup):
    """Keep complete card histories, including placement, and deduplicate synced logs."""
    if backup.get("format") != "langocard-backup" or backup.get("version") != 2:
        raise ValueError("Expected a version 2 Langocard backup")
    reviews = {}
    for row in backup["data"].get("reviews", []):
        log = json.loads(row["log"]) if isinstance(row["log"], str) else row["log"]
        time = datetime.fromisoformat(log["review_datetime"].replace("Z", "+00:00"))
        if time.tzinfo is None:
            raise ValueError("Review timestamps must include a timezone")
        rating = RATINGS[log["rating"]]
        duration = log.get("reviewDuration")
        if duration is None:
            duration = 10000
        if not isinstance(duration, int) or duration <= 0:
            raise ValueError("Review duration must be positive milliseconds")
        review = Review(row["key"], rating, time, duration)
        identity = (review.key, time)
        if identity in reviews and reviews[identity] != review:
            raise ValueError("Conflicting reviews for the same card and timestamp")
        reviews[identity] = review
    return sorted(reviews.values(), key=lambda r: (r.time, r.key))


def training_review_count(reviews):
    """Count loss-bearing reviews under the pinned optimizer's history limits."""
    previous = {}
    counts = {}
    usable = 0
    for review in sorted(reviews, key=lambda r: (r.time, r.key)):
        count = counts.get(review.key, 0)
        if count >= MAX_CARD_HISTORY:
            continue
        last = previous.get(review.key)
        if last is not None and (review.time - last).days > 0:
            usable += 1
        previous[review.key] = review.time
        counts[review.key] = count + 1
    return usable


def fit(reviews):
    """Fit memory weights and estimate retention using the pinned simulator."""
    if len(reviews) < MIN_REVIEWS:
        raise ValueError(f"Need at least {MIN_REVIEWS} unique reviews; found {len(reviews)}. Keep studying before fitting.")
    usable = training_review_count(reviews)
    if usable < MIN_TRAINING_REVIEWS:
        raise ValueError(f"Need at least {MIN_TRAINING_REVIEWS} day-spaced training reviews within each card\'s first {MAX_CARD_HISTORY} reviews; found {usable}. Keep studying before fitting.")
    from fsrs import Optimizer, Rating, ReviewLog
    import numpy as np
    import torch
    random.seed(42)
    np.random.seed(42)
    torch.manual_seed(42)
    ids = {key: i for i, key in enumerate(sorted({r.key for r in reviews}))}
    logs = [ReviewLog(ids[r.key], Rating(r.rating), r.time, r.duration) for r in reviews]
    optimizer = Optimizer(logs)
    parameters = optimizer.compute_optimal_parameters()
    retention = float(optimizer.compute_optimal_retention(parameters))
    if len(parameters) != 21:
        raise ValueError("Optimizer did not return FSRS-6 parameters")
    return {"format": "langocard-fsrs", "version": 1, "parameters": parameters,
            "desiredRetention": retention, "reviewCount": len(reviews),
            "fitDate": datetime.now(timezone.utc).isoformat(),
            "optimizer": "fsrs==6.3.0", "durationAssumption": "Missing durations use 10000 ms"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("backup", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    try:
        result = fit(extract(json.loads(args.backup.read_text())))
        args.output.write_text(json.dumps(result, indent=2, allow_nan=False) + "\n")
    except (ValueError, KeyError, TypeError, ImportError) as error:
        parser.exit(1, f"Cannot fit FSRS: {error}\n")


if __name__ == "__main__":
    main()
