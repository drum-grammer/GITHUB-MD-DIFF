# Checkout Service v2 — Design Document

> Status: In review · Owner: Payments Platform · Last updated: 2026-10-07

## 1. Overview

Checkout Service v2 replaces the monolithic checkout flow with a set of small services that own cart pricing, payment authorization, and order confirmation. The goal is to cut checkout latency, make failures recoverable, and let each team ship independently.

This document describes the target architecture, the public API, the data model, and the rollout plan. It was drafted with an AI coding assistant and reviewed by the payments team.

## 2. Goals

- Reduce p95 checkout latency to under 200 ms.
- Recover from payment provider timeouts without double charging.
- Let the pricing, payment, and order teams deploy independently.
- Keep the public checkout API backward compatible for one year.
- Show users the final payment status within 5 seconds.

## 3. Non-goals

- Changing the cart UI or the payment page design.
- Supporting new payment providers in the first release.
- Migrating historical orders older than 18 months.

## 4. Background

Today every checkout request goes through one service that prices the cart, calls the payment provider, writes the order, and sends the confirmation email in a single transaction. When the provider is slow, the whole request waits; when it times out, we retry the full flow and occasionally charge twice.

Incident reviews from the last two quarters point to the same three causes:

1. Long-running synchronous calls to the payment provider.
2. Retries that are not idempotent.
3. One deploy pipeline for four teams, which delays urgent fixes.

## 5. Architecture

### 5.1 Services

The new design splits checkout into three services connected by an event bus:

- **Pricing** computes the final amount, taxes, and discounts. It is stateless and caches tax tables.
- **Payment** authorizes and captures payments. Every request carries an idempotency key, so a retry never charges twice.
- **Order** writes the order, reserves inventory, and emits the `OrderConfirmed` event.

The checkout API gateway calls Pricing synchronously and hands off to Payment through a queue. The client polls an order status endpoint or receives a push notification when the order is confirmed.

### 5.2 Failure handling

Payment timeouts move the order to `PENDING_PAYMENT`. A reconciler runs every 30 seconds, asks the provider for the final status, and either confirms or cancels the order. Users see a "processing" screen instead of an error, and on-call gets an alert if an order stays pending for more than 10 minutes.

### 5.3 Observability

Each service exports request latency, error rate, and queue depth. A single trace ID follows the request from the gateway to the confirmation email.

## 6. Public API

| Endpoint | Method | Purpose | Auth |
|---|---|---|---|
| `/v2/checkout` | POST | Start a checkout from a cart | User token |
| `/v2/orders/{id}` | GET | Read order status | User token |
| `/v2/orders/{id}/cancel` | POST | Cancel a pending order | User token |
| `/v2/payments/webhook` | POST | Provider callbacks | Signed secret |

All endpoints return JSON. Errors use the shared error format with a stable `code` field.

### 6.1 Request examples

Start a checkout:

```http
POST /v2/checkout
Authorization: Bearer <user token>
Idempotency-Key: 7f3c2a90-1b44-4c55-9a0e-2f6d1c8b5e10

{
  "cart_id": "cart_9F2K",
  "payment_method_id": "pm_card_visa",
  "shipping_address_id": "addr_12"
}
```

Response:

```json
{
  "order_id": "ord_51XQ",
  "status": "PENDING_PAYMENT",
  "poll_after_ms": 1500
}
```

Read the order status:

```http
GET /v2/orders/ord_51XQ
Authorization: Bearer <user token>
```

```json
{
  "order_id": "ord_51XQ",
  "status": "CONFIRMED",
  "total": { "amount": 4290, "currency": "USD" },
  "confirmed_at": "2026-10-01T09:12:44Z"
}
```

### 6.2 Error codes

| Code | HTTP | Meaning | Client action |
|---|---|---|---|
| `CART_EXPIRED` | 409 | The cart is older than 30 days | Ask the user to refresh the cart |
| `PRICE_CHANGED` | 409 | Prices changed since the cart was built | Show the new total and confirm |
| `PAYMENT_DECLINED` | 402 | The provider declined the payment | Ask for another payment method |
| `RATE_LIMITED` | 429 | Too many attempts | Retry after the `Retry-After` header |
| `INTERNAL` | 500 | Unexpected failure | Retry with the same idempotency key |

## 7. Data model

| Table | Owner | Key fields | Retention |
|---|---|---|---|
| `carts` | Pricing | cart_id, user_id, items | 30 days |
| `payments` | Payment | payment_id, order_id, idempotency_key, status | 7 years |
| `orders` | Order | order_id, user_id, total, status | 7 years |
| `inventory_holds` | Order | hold_id, sku, quantity, expires_at | 1 day |

## 8. Rollout plan

| Phase | Scope | Traffic | Status |
|---|---|---|---|
| 1 | Internal employees | 1% | Done |
| 2 | One region | 10% | In progress |
| 3 | All regions | 100% | Planned |
| 4 | Remove the old flow | 100% | Planned |

Each phase needs one week of stable error rates before the next one starts. The old flow stays deployed behind a feature flag until phase 3 has run for a month.

## 9. Risks

- The event bus becomes a single point of failure. Mitigation: two clusters in separate zones.
- The reconciler could cancel orders the provider later confirms. Mitigation: a manual review queue for late confirmations.
- Teams may drift on the shared error format. Mitigation: a contract test in each pipeline.
- Webhook retries from the provider can arrive out of order. Mitigation: process them by event timestamp, not arrival time.

## 10. Open questions

- Should Pricing own coupon validation or stay purely computational?
- Do we need a separate service for receipts, or does Order send them?
- What is the right timeout for the provider call before moving to `PENDING_PAYMENT`?

## 12. Migration

### 12.1 Steps

1. Deploy Pricing behind the existing checkout service and compare its totals with the old calculation for two weeks.
2. Turn on dual writes for orders so that both the old and new tables receive every order.
3. Route internal employee traffic through the new gateway.
4. Backfill orders from the last 18 months into the new `orders` table.
5. Switch reads to the new tables and keep the old ones read-only for one month.
6. Remove the dual-write code and archive the old tables.

### 12.2 Backfill details

The backfill job reads the old orders table in batches of 10,000 rows ordered by creation time. Each batch is written with an upsert, so the job can stop and resume at any point. A checksum job compares row counts and totals per day between the old and new tables and reports any mismatch to the payments channel.

## 13. Testing strategy

- **Unit tests** cover pricing rules, tax rounding, and idempotency key handling.
- **Contract tests** check every service against the shared error format and the event schemas.
- **Load tests** replay one week of production traffic at three times the normal rate.
- **Chaos tests** inject provider timeouts, duplicate webhooks, and event bus outages in staging every night.
- **Shadow traffic** sends a copy of real checkout requests to the new stack without charging anyone.

## 14. Security and compliance

- Card data never touches our services; the provider returns a payment method token.
- All service-to-service calls use mutual TLS with certificates rotated every 30 days.
- Webhooks are verified with the provider's signing secret and rejected if older than five minutes.
- Access to the `payments` table is limited to the Payment service account and the on-call break-glass role.
- Audit logs for refunds and manual order changes are kept for seven years.

## 15. Cost estimate

| Item | Monthly cost | Notes |
|---|---|---|
| Compute (3 services) | $4,200 | Autoscaled, 6 to 24 instances |
| Event bus (2 clusters) | $1,800 | Two zones for failover |
| Database | $2,600 | Primary plus one read replica |
| Observability | $900 | Traces sampled at 10% |
| **Total** | **$9,500** | About 15% more than today |

## 16. Alternatives considered

### 16.1 Keep the monolith and add a payment queue

This would fix the synchronous wait but not the shared deploy pipeline. Teams would still block each other, and the duplicate-charge risk would move into the queue consumer instead of going away.

### 16.2 Use the provider's hosted checkout page

The hosted page removes most of the payment code but takes control of the checkout experience away from us. It also does not support split shipments, which 8% of orders use.

### 16.3 One service per team without an event bus

Direct calls between services are simpler at first, but every new consumer of order events would need changes in the Order service. The event bus keeps producers and consumers independent.

## 17. Appendix

### 17.1 Glossary

- **Idempotency key** — a client-generated ID that makes repeated requests safe.
- **Reconciler** — a background job that resolves uncertain payment states.
- **Hold** — a temporary inventory reservation that expires automatically.

### 17.2 References

- Incident review: checkout timeouts (Q2)
- Incident review: duplicate charges (Q3)
- Payments platform roadmap
