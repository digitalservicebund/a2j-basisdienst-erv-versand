---
status: accepted
date: 2026-10-12
decision-makers: Kai Bernhard, Thore Straßburg, Pram Gurusinga
consulted: Florian Drews, Adly Elgaafary, Christoph Böhmer
---

# Adopt Asynchronous Communication Pattern for Upstream Interactions

## Context and Problem Statement

The Basisdienst: ERV Versand is an integration service for the external EGVP
(Elektronisches Gerichts- und Verwaltungspostfach) network. The job to transfer
an EGVP message can experience significant latencies, up to minutes per message.
This depends on the size of the message and its attachments, but might also be
affected by reliability and availability of external EGVP network components.

The Basisdienst must reliably receive EGVP message transfer request and
eventually reply with the result of the operation to the caller, establishing
a two-way communication. Clients of upstream contexts must remain unblocked
during a message transfer, allowing the design of a responsive user experience.
Overall, the system must be able to handle low-to-moderate overall throughput,
in the range of thousands of messages per day.

Which communication pattern should we use for interactions between the
Basisdienst and upstream contexts?

## Decision Drivers

- Upstream clients must remain responsive during a message transfer to enable a great user experience.
- Upstream contexts must be able to request transfers independently of the EGVP network availability.
- Long-running transfer jobs must not exhaust and block network connections.

## Considered Options

- Asynchronous Communication Pattern
- Synchronous Communication Pattern

## Decision Outcome

Chosen option: "Asynchronous Communication Pattern", because it natively solves
the conflict between the fast, responsive nature of upstream contexts and the
potentially slow, unpredictable EGVP network. By temporally decoupling the
systems, upstream clients can request a transfer job, immediately unblock, and
receive the result of the transfer independently as reply at a later point in
time. This prevents cascading effects from the EGVP network to upstream
contexts.

### Consequences

- Good, because upstream clients are shielded from latencies and outages of the EGVP network.
- Good, because upstream clients remain responsive for the user during a message transfer.
- Good, because it enables asymmetric scaling and optimizes resource utilization, decoupling requesting a transfer from execution.
- Good, because short connections free network resources immediately.
- Bad, because it forces upstream clients to handle the complexity of eventual consistency.
- Bad, because overall system observability and debugging become more complex.

## Pros and Cons of the Options

### Asynchronous Communication Pattern

- Good, because it natively accommodates unpredictable, long-running jobs without open network connections.
- Good, because it provides temporal decoupling, making upstream context independent of the EGVP network.
- Good, because it enables asymmetric scaling and optimizes resource utilization, decoupling requesting a transfer from execution.
- Bad, because the Access to Justice project team has limited experience with asynchronous APIs.
- Bad, because it introduces eventual consistency, requiring upstream clients to manage the state of request-reply interactions.
- Bad, because overall system observability and debugging becomes more complex.

### Synchronous Communication Pattern

- Good, because it provides a familiar, linear request-response flow that can be integrated directly.
- Good, because error propagation is immediate and natively based on the communication protocol (e.g. HTTP status codes).
- Bad, because latencies and availability issues of the EGVP directly affect connections of upstream clients.
- Bad, because it forces tight temporal coupling, making upstream boundaries depend on the EGVP network directly.
- Bad, because it often conflicts with standard network infrastructure, such as causing load balancer or proxy timeouts.

## More Information

This decision does not make any statement on how the asynchronous communication
will be implemented. Multiple solution options are possible and will be the
focus of subsequent decisions.
