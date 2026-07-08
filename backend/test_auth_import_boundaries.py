import ast
import importlib
import os
import sys
import unittest
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parent


def _set_required_env_defaults() -> None:
    os.environ["DATABASE_URL"] = "postgresql+asyncpg://user:password@localhost:5432/resumeflow"
    os.environ.setdefault("LOGTO_ISSUER", "https://example.logto.app/oidc")
    os.environ.setdefault("LOGTO_APP_ID", "resume-spa-app-id")


_set_required_env_defaults()


class AuthImportBoundaryTests(unittest.TestCase):
    def test_auth_consumers_import_authenticated_user_from_auth_types(self) -> None:
        for relative_path in (
            Path("app/dependencies.py"),
            Path("app/utils/admin_utils.py"),
        ):
            with self.subTest(path=str(relative_path)):
                self.assertFalse(
                    _imports_authenticated_user_from_auth_middleware(
                        BACKEND_DIR / relative_path
                    ),
                    f"{relative_path} must import AuthenticatedUser from app.auth_types",
                )

    def test_dependencies_loads_without_auth_middleware(self) -> None:
        sys.modules.pop("app.auth_middleware", None)
        sys.modules.pop("app.dependencies", None)

        from app.auth_types import AuthenticatedUser

        dependencies = importlib.import_module("app.dependencies")

        self.assertNotIn("app.auth_middleware", sys.modules)
        self.assertIs(dependencies.AuthenticatedUser, AuthenticatedUser)

    def test_auth_middleware_does_not_export_authenticated_user_type(self) -> None:
        from app import auth_middleware

        self.assertFalse(hasattr(auth_middleware, "AuthenticatedUser"))


def _imports_authenticated_user_from_auth_middleware(path: Path) -> bool:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if not isinstance(node, ast.ImportFrom):
            continue
        imports_authenticated_user = any(
            alias.name == "AuthenticatedUser" for alias in node.names
        )
        if not imports_authenticated_user:
            continue
        if node.level > 0 and node.module == "auth_middleware":
            return True
        if node.level == 0 and node.module == "app.auth_middleware":
            return True
    return False


if __name__ == "__main__":
    unittest.main()
