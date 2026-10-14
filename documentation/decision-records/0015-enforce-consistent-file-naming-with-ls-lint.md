---
status: accepted
decision-makers: Thore Straßburg
date: 2026-09-28
---

# Enforce Consistent File Naming with Ls-Lint

## Context and Problem Statement

Most static analysis tools for quality assurance on the content of files.
File and directory names are rarely covered, especially not for the full
repository. Inconsistent naming creates background noise, that creates minimal
cognitive load. In contrast, a clean filesystem can reduce friction when working
on a codebase. Partially, it can even cause cross-platform bugs, like
inconsistent case sensitivity in file paths.

How can we improve our quality assurance to enforce more consistent naming
patterns?

## Decision Outcome

Chosen option: "[ls-lint](https://ls-lint.org)", because it allows to apply
rules and naming schemata to all files with a straightforward configuration. It
is fast enough to analysis the whole code repository super quickly, without
affecting workflow runtimes negatively.

### Consequences

- Good, because the repository becomes more consistent and uniform.
- Good, because cross-platform issues will be avoided.
- Neutral, there is no integration for editors, possibly delaying feedback.
- Bad, because some existing files have to be renamed.

## More Information

We chose kebab-case as default for this respository.
