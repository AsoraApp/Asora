# Commercial Architecture (Non-Billing)

## Plans as Execution Constraints
Plans define **hard backend limits**, not pricing metadata.

Enforcement occurs inside write paths and fails closed.

## Example Plan Limits

| Capability | Free | Pro | Enterprise |
|---------|------|-----|------------|
| Items | Limited | Expanded | Custom |
| Hubs/Bins | Limited | Expanded | Custom |
| Vendors | Limited | Expanded | Custom |
| Exports | Limited | Full | Full |
| Integrations | None | Limited | Custom |

## Explicitly Out of Scope
- Billing
- Subscriptions
- Invoicing
- Payment processing

## Operational Enforcement
When limits are exceeded:
- Action is rejected
- No partial mutation occurs
- Audit event is emitted
