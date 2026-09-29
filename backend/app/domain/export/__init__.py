"""PDF export domain with a lazily loaded route compatibility export."""

__all__ = ["router"]


def __getattr__(name: str):
    if name == "router":
        from .export_router import router

        return router
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
