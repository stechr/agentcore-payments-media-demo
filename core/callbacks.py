"""Callback protocol for demo events — consumed by UI, notebook, or stdout."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable


@dataclass
class TrustCheckEvent:
    merchant_id: str
    merchant_name: str
    trust_score: float | None
    total_transactions: int
    dispute_rate: float
    decision: str  # "PROCEED" | "CAUTION" | "SKIP" | "TRIAL"


@dataclass
class DecisionEvent:
    action: str  # "BUY" | "SKIP" | "TRIAL"
    merchant_name: str
    article_title: str
    price: float
    reason: str


@dataclass
class PurchaseEvent:
    merchant_name: str
    article_title: str
    price: float
    tx_hash: str | None = None
    success: bool = True


@dataclass
class BudgetUpdateEvent:
    spent: float
    remaining: float
    total: float
    articles_purchased: int


@dataclass
class FeedbackEvent:
    merchant_id: str
    article_id: str
    rating: int
    reason: str


@runtime_checkable
class DemoCallbacks(Protocol):
    """Protocol for receiving demo events. Implement any subset."""

    def on_trust_check(self, event: TrustCheckEvent) -> None: ...
    def on_decision(self, event: DecisionEvent) -> None: ...
    def on_purchase(self, event: PurchaseEvent) -> None: ...
    def on_budget_update(self, event: BudgetUpdateEvent) -> None: ...
    def on_feedback(self, event: FeedbackEvent) -> None: ...


class PrintCallbacks:
    """Simple stdout callbacks for CLI/script usage."""

    def on_trust_check(self, event: TrustCheckEvent) -> None:
        icon = {"PROCEED": "✅", "CAUTION": "⚠️", "SKIP": "❌", "TRIAL": "🔍"}.get(event.decision, "❓")
        score = f"{event.trust_score}/5" if event.trust_score else "N/A"
        print(f"  {icon} Trust: {event.merchant_name} — {score} ({event.total_transactions} txns, {event.dispute_rate*100:.0f}% disputes) → {event.decision}")

    def on_decision(self, event: DecisionEvent) -> None:
        icon = {"BUY": "✅", "SKIP": "❌", "TRIAL": "🔍"}.get(event.action, "❓")
        print(f"  {icon} DECISION: {event.action} | {event.merchant_name} | {event.article_title} | ${event.price:.4f} | {event.reason}")

    def on_purchase(self, event: PurchaseEvent) -> None:
        if event.success:
            print(f"  💳 Purchased: {event.article_title} from {event.merchant_name} — ${event.price:.4f}")
        else:
            print(f"  ❌ Payment failed: {event.article_title} from {event.merchant_name}")

    def on_budget_update(self, event: BudgetUpdateEvent) -> None:
        pct = (event.spent / event.total * 100) if event.total > 0 else 0
        bar_len = 20
        filled = int(pct / 100 * bar_len)
        bar = "█" * filled + "░" * (bar_len - filled)
        print(f"  💰 Budget: [{bar}] ${event.spent:.4f} / ${event.total:.2f} ({event.articles_purchased} articles)")

    def on_feedback(self, event: FeedbackEvent) -> None:
        stars = "★" * event.rating + "☆" * (5 - event.rating)
        print(f"  {stars} Rated {event.merchant_id}/{event.article_id}: {event.reason}")


class CollectorCallbacks:
    """Collects events into lists — useful for notebook display or testing."""

    def __init__(self):
        self.trust_checks: list[TrustCheckEvent] = []
        self.decisions: list[DecisionEvent] = []
        self.purchases: list[PurchaseEvent] = []
        self.budget_updates: list[BudgetUpdateEvent] = []
        self.feedbacks: list[FeedbackEvent] = []

    def on_trust_check(self, event: TrustCheckEvent) -> None:
        self.trust_checks.append(event)

    def on_decision(self, event: DecisionEvent) -> None:
        self.decisions.append(event)

    def on_purchase(self, event: PurchaseEvent) -> None:
        self.purchases.append(event)

    def on_budget_update(self, event: BudgetUpdateEvent) -> None:
        self.budget_updates.append(event)

    def on_feedback(self, event: FeedbackEvent) -> None:
        self.feedbacks.append(event)
