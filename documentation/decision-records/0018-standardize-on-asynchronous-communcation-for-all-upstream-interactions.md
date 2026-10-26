---
status: accepted
date: 2026-10-12
decision-makers: Kai Bernhard, Thore Straßburg, Pram Gurusinga
consulted: Adly Elgaafary
---

# Standardize on Asynchronous Communication for All Upstream Interactions

## Context and Problem Statement

Previous architectural decisions established an asynchronous communication
pattern via a managed RabbitMQ message broker for the primary use case of the
Basisdienst: ERV Versand (transferring EGVP messages). This was necessary,
because message transfers are long-running jobs that require temporal decoupling
and strict at-least-once delivery guarantees. Interactions follow the
two-way exchange of request-reply messages.

Alongside EGVP message transfers, the Basisdienst must support secondary use
cases, such as querying the VAS (Virtueller Attributservice) to search for
identities or verifying the role of a user in the EGVP network. Unlike EGVP
message transfers, an identity lookup is relatively fast. A successful lookup
typically takes a few seconds. If the external VAS is unavailable, it is treated
as a standard API error, rather than a job that needs to be requeued for an
extended period. By their nature, these operations perfectly fit into a standard
synchronous request-response communication pattern.

It must be decided whether to split the API and expose these fast, supportive
operations synchronously, or model them into a uniform asynchronous API,
matching the primary integration pattern.

Which communication pattern should we use for fast, supportive operations like
identity lookups?

## Decision Drivers

- Minimize upstream clients integration effort by reusing existing communication patterns.
- Architectural simplicity to reduce operational effort and development overhead.
- End-to-end latency must remain low to maintain a good user experience.

## Considered Options

- Uniform Asynchronous API
- Hybrid API

## Decision Outcome

Chosen option: "Uniform Asynchronous API", because we prioritize architectural
consistency to reduce total cost of ownership for both the Basisdienst as well
as upstream contexts. Although identity lookups are technically synchronous and
fast, it would require maintaining two completely different interfaces based on
different communication patterns and different technology (e.g., AMQP and HTTP
REST). Upstream contexts are already forced to implement the asynchronous
request-reply pattern for the primary use case to transfer EGVP messages.
Reusing this exact same mechanism for identity lookups is less overall
integration effort.

### Consequences

- Good, because upstream clients must implement and maintain only one integration pattern.
- Good, because the architecture for the Basisdienst remains lean, exposing only the message broker.
- Good, because security policies need to be enforced at only one infrastructure component.
- Bad, because it introduces messaging latency for otherwise synchronous operations.
- Bad, because it forces clients into a more complex interaction model for otherwise plain data queries.

## Pros and Cons of the Options

### Uniform Asynchronous API

All interactions with the Basisdienst happen as operations via the message broker.

- Good, because it provides a single, unified architectural boundary, minimizing the overall operational footprint of the Basisdienst.
- Good, because it leverages the existing asynchronous capabilities that upstream clients must already use.
- Bad, because it is structurally over-engineered for fast, stateless queries.

### Hybrid API

Separate asynchronous API via message broker for EGVP message transfer
operations and synchronous API via HTTP server for identity lookups.

- Good, because it aligns the communication patterns with the technical nature of the underlying operations.
- Good, because fast identity lookups are resolved immediately in a single call, vastly simplifying upstream clients.
- Bad, because the Basisdienst must maintain two separate interfaces with different communication patterns.
- Bad, because upstream clients must maintain two separate integrations with the Basisdienst.
