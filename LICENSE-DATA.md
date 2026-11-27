# Data and content license

The **code** in this repository is under the MIT License (see `LICENSE`).

The **data Qatalogue builds and the site's own content** (Qatalogue's own work) are under the
[Creative Commons Attribution 4.0 International license (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/)
([legal code](https://creativecommons.org/licenses/by/4.0/legalcode)). That covers:

- the served database (`data/serve.db`) and the default summaries (`public/default-*.json.gz`);
- the institution and researcher lists, scores, networks and charts the site shows, including exported images and tables;
- the topic taxonomy, its answer key and reports (`data/taxonomy.json`, `data/topics/`), and the methodology text.

Records taken from the sources below, such as paper titles, identifiers and names, stay under the sources' own terms.

You may share and adapt them for any purpose, commercial included, as long as you give credit, link to the license and say
whether you made changes. A suggested credit:

> Qatalogue, an open bibliometric explorer for quantum information science and technology, by Shadnan Azwad Khan.
> Data from OpenAlex, ROR and arXiv. Licensed under CC BY 4.0.

## Logo and favicon

The Qatalogue logo and favicon (`public/qatalogue.svg`, `public/favicon.ico`) are copyright © 2026 Shadnan Azwad Khan,
all rights reserved, and are not covered by the MIT or CC BY 4.0 licenses.

## Sources

| Source | Scope | Terms |
|---|---|---|
| [OpenAlex](https://openalex.org) | works, authors, institutions, topics | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| [ROR](https://ror.org) | institution identifiers and locations | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| [arXiv](https://arxiv.org) | abstracts and subject categories | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) metadata ([API terms](https://info.arxiv.org/help/api/tou.html)) |

Article-type metadata from [Springer Nature](https://dev.springernature.com/) and
[APS](https://harvest.aps.org/docs/harvest-api) is used during build-time filtering to exclude non-research items
(under the publishers' terms) and is not included in the served database.

Abstracts are not redistributed; the served database holds only a contentless full-text index and embedding vectors.
Upstream records remain under their respective terms, and attribution does not imply endorsement.

Paper search uses `Xenova/bge-small-en-v1.5` (MIT License), downloaded during `make embed` rather than distributed here.
Bundled fonts (Inter, Outfit, Roboto Mono, Special Gothic Expanded One) are under the SIL Open Font License 1.1.
