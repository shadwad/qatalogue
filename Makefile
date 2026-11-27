.PHONY: help lint test archive all database build start dev clean locations import enrich embed classify topics merge canonical performance default geo search check finalize setup topics-discover measure-merges

PYTHON ?= ./.venv/bin/python3
RUN_PY = PYTHONPATH=. $(PYTHON)
SCRIPTS = pipeline/scripts

.DEFAULT_GOAL := help
help:
	@echo "make setup      create .venv, install dependencies, create .env"
	@echo "make all        fetch, build, check, and publish data/serve.db"
	@echo "make test       run both test suites"
	@echo "make lint       run typecheck and pyflakes"
	@echo "make dev        start development server"
	@echo "make build      build production bundle (dist/)"
	@echo "make start      start production server"
	@echo "make clean      remove dist/"
	@echo "make archive    archive built data (ARGS=--dry-run, ARGS=--keep-cache)"
	@echo "Pipeline steps: import enrich embed classify topics merge database check finalize"

archive:
	$(RUN_PY) $(SCRIPTS)/archive_data.py $(ARGS)

lint:
	npm run typecheck
	$(RUN_PY) -m pyflakes pipeline tests/pipeline

test:
	npm test
	$(RUN_PY) -m unittest discover -s tests/pipeline

all: import enrich embed classify topics merge database check finalize

database: locations canonical performance default geo search

import:
	@echo "Fetching OpenAlex data..."
	$(RUN_PY) $(SCRIPTS)/import.py

enrich:
	@echo "Enriching papers..."
	$(RUN_PY) $(SCRIPTS)/enrich_papers.py
	$(RUN_PY) $(SCRIPTS)/fetch_article_types.py

embed:
	@echo "Embedding papers..."
	node $(SCRIPTS)/embed_papers.mjs

classify:
	@echo "Classifying article types..."
	$(RUN_PY) $(SCRIPTS)/classify_articles.py

topics:
	@echo "Assigning topics and platforms..."
	$(RUN_PY) $(SCRIPTS)/assign_topics.py --staged

merge:
	@echo "Merging authors and institutions..."
	$(RUN_PY) $(SCRIPTS)/merge_entities.py

locations:
	@echo "Building location mapping..."
	npm run locations -- --staged

canonical:
	@echo "Building canonical facts..."
	$(RUN_PY) $(SCRIPTS)/build_canonical_facts.py

performance:
	@echo "Computing performance summaries..."
	$(RUN_PY) $(SCRIPTS)/build_performance_summary.py

default:
	@echo "Generating default summaries..."
	$(RUN_PY) $(SCRIPTS)/build_default_summary.py

geo:
	@echo "Attaching institution coordinates..."
	$(RUN_PY) $(SCRIPTS)/build_geo.py

search:
	@echo "Building search index..."
	$(RUN_PY) $(SCRIPTS)/build_search_index.py

check:
	@echo "Checking staged build..."
	$(RUN_PY) $(SCRIPTS)/check_build.py $(CHECK_ARGS)

finalize:
	@echo "Finalizing build..."
	$(RUN_PY) $(SCRIPTS)/finalize_build.py

# Re-cluster papers (~8 min) into data/topics/discovery.json (not part of `all`).
topics-discover:
	@echo "Clustering papers..."
	$(RUN_PY) $(SCRIPTS)/discover_topics.py

# Score author merging against masked ORCIDs (not part of `all`).
measure-merges:
	$(RUN_PY) $(SCRIPTS)/measure_merges.py $(ARGS)

build:
	npm run build

start:
	npm start

clean:
	npm run clean

setup:
	@echo "Running setup..."
	./scripts/setup.sh

dev:
	@echo "Starting development server..."
	npm run dev
