---
status: accepted
date: 2026-10-12
decision-makers: Kai Bernhard, Thore Straßburg, Pram Gurusinga
consulted: Adly Elgaafary
---

# Require Attachments as References to Upstream-Served Resources

## Context and Problem Statement

Previous architectural decisions established that the Basisdienst: ERV Versand
uses an asynchronous communication pattern via a managed RabbitMQ message broker
to handle EGVP message transfer jobs.

A single EGVP message can contain up to 1,000 attachments totaling up to 1 GiB.
Message brokers are inherently unsuited for payloads of this magnitude. For
RabbitMQ, the default message size limit is 16 MiB. While the broker permits an
absolute maximum of 512 MiB, the recommendation is to keep the limits below
128 MiB. Forcing larger messages through the service degrades performance,
destabilizes the broker, and rapidly exhausts memory limits.

We need a mechanism to pass these potentially massive attachments through the
asynchronous integration process without overloading the message broker.
Crucially, we must define exactly within which context boundary the data is
managed and where consistency rules are enforced. Attachments must be available
from the time the EGVP message transfer is initiated until the job concludes,
regardless of success or failure, while strictly adhering to data minimalism
principles.

How should we handle massive EGVP attachments within an asynchronous messaging
architecture?

## Decision Drivers

- Fulfill the requirement of 1 GiB total attachments, which exceeds the size limits of RabbitMQ.
- Preserve message broker performance and prevent memory exhaustion by enforcing lightweight messages.
- Establish a definite boundary for data ownership and the enforcement of consistency rules.
- Minimize the infrastructural footprint and statefulness of the Basisdienst.

## Considered Options

- Require Attachments as References to Upstream-Served Resources
- Stateful Pre-Transfer Upload API
- Direct Attachment Embedding

## Decision Outcome

Chosen option: "Require Attachments as References to Upstream-Served Resources",
because it decouples attachment sizes from the limits of the message broker. By
transmitting only metadata and references, messages remain lightweight. Relying
on standard HTTPS GET URLs keeps the integration agnostic to how the resources
are served. However, because attachments may contain sensitive legal data,
upstream contexts must properly secure these resources (e.g., pre-signed URLs and
strict firewall configurations).

The decision shifts the responsibility for data management, consistency, and
resource availability entirely to the upstream contexts, which own the business
process. The Basisdienst downloads attachments only temporarily to transfer them
to the EGVP network. If a referenced attachment cannot be downloaded, the entire
transfer job fails and triggers a corresponding reply message. Upstream contexts
should use the reply message as an event to enforce their consistency rules and
to apply data minimalism. Because distributed systems are subject to various
error scenarios, upstream contexts must not rely on reply messages alone, but
complement them with measures like Time-to-Live garbage collection.

This approach keeps the Basisdienst lean and avoids the need for persistent
state. It avoids the complexity of additional infrastructure and limits data
management responsibilities. Complexity and responsibility are shifted to the
upstream contexts instead.

### Consequences

- Good, because attachments can exceed the size limits of the message broker.
- Good, because messages are lightweight and the broker remains fast and stable.
- Good, because the Basisdienst does not need to provision a secure, stateful storage solution for attachments.
- Neutral, because data management responsibilities remain primarily in the domain of upstream contexts.
- Bad, because it introduces temporal coupling between the contexts for the data lifecycle.
- Bad, because upstream contexts must build and maintain infrastructure to serve attachment resources via HTTPS.
- Bad, because upstream contexts must establish a mechanism to share attachments securely to protect sensitive legal information.
- Bad, because it reduces the versatility of the Basisdienst across network boundaries due to higher infrastructure-level integration costs to make attachments accessible.

## Pros and Cons of the Options

### Require Attachments as References to Upstream-Served Resources

A decentralized variation of the Claim Check pattern, where attachments remain
within the upstream context and are shared via references inside the message
payload. References can be downloaded from plain HTTPS GET URLs for the EGVP
message transfer only.

- Good, because it supports attachment sizes larger than message broker limits.
- Good, because messages are lightweight and the broker remains fast and stable.
- Good, because no extra infrastructure is required for the Basisdienst.
- Bad, because it introduces temporal coupling between the contexts for the data lifecycle.
- Bad, because upstream contexts maintain infrastructure to serve attachment resources via HTTPS.
- Bad, because attachments must be shared securely to protect sensitive legal information
- Bad, because the infrastructure must be set up to allow sharing attachments cross boundaries.

### Stateful Pre-Transfer Upload API

The classic centralized Claim Check pattern, where upstream clients upload
attachments to the Basisdienst before initiating the EGVP message transfer.
Attachments are linked via references inside the message payload.

- Good, because it supports attachment sizes larger than message broker limits.
- Good, because messages are lightweight and the broker remains fast and stable.
- Good, because it avoids temporal coupling between the contexts for the data lifecycle.
- Neutral, because upstream contexts can have reduced data management complexity.
- Bad, because the upload requires an additional communication channel next to the message broker.
- Bad, because it requires the stateful enforcement of data consistency rules.
- Bad, because it requires additional infrastructure to be maintained by the Basisdienst.

### Direct Attachment Embedding

Attachments are Base64-encoded and directly embedded into the message payload.

- Good, because messages are self-contained and automatically consistent.
- Good, because it completely eliminates temporal coupling between the contexts for the data lifecycle.
- Good, because no extra infrastructure is required.
- Neutral, because upstream contexts can have reduced data management complexity.
- Bad, because the requirement of 1 GiB total attachments exceeds message broker limitations.
- Bad, because large payloads smaller than maximum message broker limits can cause performance and stability issues.
