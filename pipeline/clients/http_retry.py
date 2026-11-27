"""
Shared HTTP client with exponential backoff on 429/5xx and transport/parse errors.

Non-retryable 4xx statuses (e.g. 400, 404) raise urllib.error.HTTPError immediately; exhausted
attempts raise RetriesExhausted.
"""
from __future__ import annotations

import http.client
import logging
import time
import urllib.error
import urllib.request
from typing import Callable

logger = logging.getLogger("http")

RETRY_STATUSES = frozenset({429, 500, 502, 503, 504})


class RetriesExhausted(RuntimeError):
    """Every attempt failed in a retryable way. `status` is the last HTTP status, or None for a network error."""

    def __init__(self, message: str, status: int | None):
        super().__init__(message)
        self.status = status


def doubling(limit: float = 60.0, start: float = 1.0) -> Callable[[int], float]:
    """Waits of start, 2·start, 4·start, ... seconds after attempts 0, 1, 2, ..., capped at limit."""
    return lambda attempt: min(limit, start * 2 ** attempt)


def request(url: str, *, data: bytes | None = None, headers: dict | None = None, timeout: float = 60,
            attempts: int = 6, pause: float = 0.0, backoff: Callable[[int], float] = doubling(),
            read: Callable = lambda response: response.read(), parse: Callable = lambda body: body,
            parse_errors: tuple = (ValueError,), shown: str | None = None):
    """GET (or POST, with `data`) `url` and return parse(read(response)).

    pause     seconds to wait before every attempt (a client's rate limit)
    backoff   seconds to wait after a failed attempt, given the attempt number
    read      reads the body from the open response (e.g. only the first part of a page)
    parse     turns the body into the result; raising one of parse_errors counts as a cut-short response
    shown     the URL as logged (a client hides its API key this way)
    """
    shown = shown or url
    last, status = None, None
    for attempt in range(attempts):
        if pause:
            time.sleep(pause)
        try:
            with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=headers or {}),
                                        timeout=timeout) as response:
                return parse(read(response))
        except urllib.error.HTTPError as e:
            if e.code not in RETRY_STATUSES:
                raise
            e.close()  # the error response holds the connection open
            last, status = e, e.code
        except (OSError, http.client.HTTPException, *parse_errors) as e:   # URLError and timeouts are OSErrors
            last, status = e, None
        if attempt + 1 < attempts:
            wait = backoff(attempt)
            logger.warning(f"{last} for {shown}; retrying in {wait:g}s")
            time.sleep(wait)
    raise RetriesExhausted(f"Gave up on {shown} after {attempts} attempts: {last}", status)
