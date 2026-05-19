import logging
import time
import uuid

logger = logging.getLogger("app")


def setup_logging(level: int = logging.INFO) -> None:
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
    )


def new_request_id() -> str:
    return str(uuid.uuid4())


class MetricsHooks:
    """Placeholder hooks for future Prometheus / OpenTelemetry wiring."""

    @staticmethod
    def record_chat_latency_ms(latency_ms: float, labels: dict[str, str] | None = None) -> None:
        _ = (latency_ms, labels)

    @staticmethod
    def increment_counter(name: str, value: int = 1, labels: dict[str, str] | None = None) -> None:
        _ = (name, value, labels)


def log_duration_ms(label: str, start_perf: float) -> None:
    elapsed_ms = (time.perf_counter() - start_perf) * 1000
    logger.debug("%s completed in %.2f ms", label, elapsed_ms)
    MetricsHooks.record_chat_latency_ms(elapsed_ms, {"step": label})
