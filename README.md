# Basisdienst: ERV Versand

> The Basisdienst: ERV Versand is an integration service that provides basic
> capabilities for sending messages to courts, lawyers, and other participants of
> the ERV (Elektronischer Rechtsverkehr)

The Basisdienst: ERV Versand is part of the project [Zugang zum
Recht](https://www.zugang-zum-recht-projekte.de/) (Access to Justice - A2J),
with the mission to empower citizens to learn about their rights and assert them
online. The [Elektronischer Rechtsverkehr](https://www.bundesjustizamt.de/DE/DasBfJ/Kontakt/Rechtsverkehr/Rechtsverkehr_node.html)
(electronic legal traffic - ERV) provides the foundation to exchange legal data
between participants of the German justice system. For example, this enables
citizens to file their claims to a court online. To support services to
participate in this exchange effectively, the Basisdienst: ERV Versand helps to
integrate with the ERV and provide basic capabilities to send messages to other
participants like courts or lawyers.

> [!TIP]
> The domain language of the German justice system is German. As it is the
> ubiquitous language, there is a heavy mix of German domain terms surrounded by
> English. More on this in the related [design principles](./DESIGN_PRINCIPLES.md#german-domain-language).

## Motivation

The infrastructure for the ERV is the [EGVP](https://egvp.justiz.de/)
(Elektronisches Gerichts- und Verwaltungspostfach) network. Its implemented
based on the
[OSCI](https://www.itzbund.de/DE/itloesungen/standardloesungen/osci/osci_node.html)
(Online Services Computer Interface) communication protocol to guarantee
integrity, authenticity, confidentiality, and traceability.

The EGVP is secure and strictly legally compliant. However, it doesn't
necessarily integrate well with modern, cloud native software systems. It is
especially challenging for public online services to make use of it directly.

The Basisdienst: ERV Versand intends to bridge exactly this gap. As integration
service, it acts as anti-corruption layer, providing a simplified interface to
send messages. To do so it maintains a beBPo (Besonderes elektronisches
Behördenpostfach) mailbox and hosts a SES (Sende- und Empfangssystem) service to
trustfully participate as sending entity in the ERV.
