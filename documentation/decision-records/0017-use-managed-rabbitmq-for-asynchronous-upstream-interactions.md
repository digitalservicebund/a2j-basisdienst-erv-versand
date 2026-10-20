---
status: accepted
date: 2026-10-12
decision-makers: Kai Bernhard
consulted: Thore Straßburg, Pram Gurusinga
---

# Use Managed RabbitMQ Service for Asynchronous Upstream Interactions

## Context and Problem Statement

In [decision record
0016](./0016-adopt-asynchronous-communication-pattern-for-upstream-interactions.md),
the asynchronous communication pattern has been established for interactions
with upstream contexts. This enables temporal decoupling between upstream
clients and the EGVP network, ensuring clients remain responsive and unblocked,
without cascading network effects. However, it leaves open the exact mechanism
and technology to implement the pattern.

While the overall throughput of the system is low-to-moderate, in the range of
thousands of messages per day, reliability is one of the most important quality
attributes for the Basisdienst. The integration service acts as buffer against
potential unreliability and availability issues of external EGVP network
components. Message transfer jobs must be guaranteed with a strict at-least-once
delivery. Messages must not be lost in transit or dropped due to internal or
external issues.

The system must gracefully handle both recoverable errors (e.g., temporary EGVP
network outages) and unrecoverable errors (e.g., malformed payloads) without
halting the processing pipeline. The Access to Justice project team has limited
experience with asynchronous APIs and distributed systems. This makes developer
ergonomics and out-of-the-box reliability features essential. Furthermore,
chosen technology should ideally be available as a managed service by our current
cloud provider.

Which mechanism and technology should we use to implement the asynchronous
communication between the Basisdienst and upstream contexts?

## Decision Drivers

- Guaranteed at-least-once delivery for transfer jobs, surviving service restarts, internal crashes, and prolonged external network outages.
- Persistently failing transfer jobs must not halt the processing of other transfers.
- Minimize the need for custom reliability and error-handling logic.
- Minimize operational complexity with managed services and strong out-of-the-box tooling.
- Optimization for low-to-moderate throughput (thousands of transfers per day) rather than massive-scale data streaming.

## Considered Options

- Managed RabbitMQ (Smart Message Broker)
- Kafka (Distributed Commit Log)
- Managed Redis Streams (Append-Only Log)
- Brokerless HTTP Webhooks/Polling with Database

## Decision Outcome

Chosen option: "Managed RabbitMQ", because it perfectly aligns with the "smart
broker, dumb consumer" architectural paradigm. By utilizing a message broker
rather than a brokerless HTTP approach, the infrastructure natively guarantees
message persistence and temporal decoupling during prolonged EGVP network
outages. A smart message broker has the advantage to handle complex reliability
logic directly in the infrastructure (e.g., explicit acknowledgments, automated
requeuing, and dead-letter queues. Finally, adopting a managed service offering
cuts down immensely on the operational complexity. It also provides access to
helpful tooling like the Management UI for observability.

### Consequences

- Good, because we achieve high reliability out-of-the-box with the features of a smart broker.
- Good, because the Management UI accelerates onboarding developers and helps debugging.
- Good, because a managed service requires lower operational costs for the team.
- Good, because RabbitMQ exchange provides message-routing capabilities, improving evolvability.
- Neutral, because RabbitMQ has a lower ceiling in maximum performance in comparison to distributed commit logs.
- Bad, because it introduces a technology new to the project team and the broader organization.

## Pros and Cons of the Options

### Managed RabbitMQ (Smart Message Broker)

- Good, because as "smart message broker" it natively handles message acknowledgments, retries, and dead-lettering.
- Good, because the built-in Management UI provides excellent observability, reducing the learning curve for developers.
- Good, because it is available as a managed service in our cloud, heavily reducing operational costs for the team.
- Neutral, because it doesn't allow for extremely high throughput.
- Bad, because it introduces a new infrastructure dependency to the overall system.

### Kafka (Distributed Commit Log)

- Neutral, because it provides extreme scalability and throughput.
- Bad, because as "dumb message broker", it has limited reliability features, requiring it to be complemented with custom reliability logic.
- Bad, because it is not available as a managed service in our cloud, causing high operational complexity to host it ourselves.
- Bad, because it is notoriously complex to operate with a steep learning curve.

### Managed Redis Streams (Append-Only Logs)

- Good, because Redis is already used in the technology stack of the overall system.
- Good, because it is available as a managed service in our cloud, heavily reducing operational costs for the team.
- Bad, because it provides limited reliability features, requiring it to be complemented with custom reliability logic.

### Brokerless HTTP Webhooks/Polling with Database

- Good, because it relies purely on the straightforward HTTP protocol without extra infrastructure beyond a database instance.
- Bad, because it requires full custom logic to provide reliable at-least-once delivery guarantees.
- Bad, because it requires great care to maintain scalable throughput without causing issues on database locks.

## More Information

This decision is strongly based on the preparatory work of the [26th architecture
decision
record](https://github.com/digitalservicebund/a2j-rechtsantragstelle/blob/main/doc/adr/0026-use-rabbitmq-as-message-broker.md)
of the `a2j-rechtsantragstelle` repository. This predates the establishment of
the Complicated-Subsystem Team for Court Communication. Now that we are the
responsible team, the decision has been adopted to align with other decisions
forming the architecture of the new Basisdienst: ERV Versand.
