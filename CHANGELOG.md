# Changelog

All notable changes to Qatalogue are documented in this file.

## [0.1.0] - 2026-11-27

Initial public release.

### Added
- **Data pipeline:** OpenAlex, ROR, and arXiv ingestion with optional Springer Nature / APS article-type filtering, `bge-small-en-v1.5` CPU embeddings, multi-label topic/subtopic and hardware-platform assignment, author/institution entity merging, credit attribution, geocoding, and atomic SQLite build validation/finalization.
- **Explorer UI & API:** Express + `better-sqlite3` backend and React 19 / Tailwind CSS v4 frontend with institution and researcher lists, four attribution models, interactive force-directed and world-map collaboration networks with PNG export, custom statistical charts with CSV/PNG export and paper evidence tables, hybrid FTS5 + semantic paper search, and short shareable URLs.
- **Packaging & CI:** Reproducible Python (`pipeline/requirements.lock`) and Node (`package-lock.json`) setups, multi-stage `Dockerfile` + `compose.yml`, GitHub Actions CI, issue/PR templates, and dual MIT (code) / CC BY 4.0 (data & site content) licensing.
