from __future__ import annotations

import argparse
import asyncio
from pathlib import Path

from app.database import AsyncSessionFactory
from app.domain.billing.redemption_schemas import (
    RedemptionBatchCreate,
    RedemptionPackageCreate,
    RedemptionPackageUpdate,
)
from app.domain.billing import redemption_service


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Manage ResumeFLOW redemption codes.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    package_create = subparsers.add_parser("package-create", help="Create a token package.")
    package_create.add_argument("--name", required=True)
    package_create.add_argument("--tokens", required=True, type=int)
    package_create.add_argument("--notes", default="")
    package_create.add_argument("--inactive", action="store_true")

    package_update = subparsers.add_parser("package-update", help="Update a token package.")
    package_update.add_argument("package_id")
    package_update.add_argument("--name")
    package_update.add_argument("--tokens", type=int)
    package_update.add_argument("--notes")
    package_update.add_argument("--active", choices=["true", "false"])

    subparsers.add_parser("package-list", help="List token packages.")

    batch_generate = subparsers.add_parser("batch-generate", help="Generate a batch of redemption codes.")
    batch_generate.add_argument("--package-id", required=True)
    batch_generate.add_argument("--name", required=True)
    batch_generate.add_argument("--channel", default="")
    batch_generate.add_argument("--count", required=True, type=int)
    batch_generate.add_argument("--created-by", required=True)
    batch_generate.add_argument("--output")

    batch_export = subparsers.add_parser("batch-export", help="Export an existing batch as CSV.")
    batch_export.add_argument("batch_id")
    batch_export.add_argument("--output", required=True)

    batch_revoke = subparsers.add_parser("batch-revoke", help="Revoke all unused codes in a batch.")
    batch_revoke.add_argument("batch_id")
    batch_revoke.add_argument("--revoked-by", required=True)

    code_revoke = subparsers.add_parser("code-revoke", help="Revoke a specific unused code by id.")
    code_revoke.add_argument("code_id")
    code_revoke.add_argument("--revoked-by", required=True)

    return parser


async def _run(args: argparse.Namespace) -> None:
    async with AsyncSessionFactory() as session:
        if args.command == "package-create":
            result = await redemption_service.create_package(
                session,
                RedemptionPackageCreate(
                    name=args.name,
                    token_amount=args.tokens,
                    is_active=not args.inactive,
                    notes=args.notes,
                ),
            )
            print(f"created package {result.id} {result.name} tokens={result.token_amount}")
            return

        if args.command == "package-update":
            active = None if args.active is None else args.active == "true"
            result = await redemption_service.update_package(
                session,
                args.package_id,
                RedemptionPackageUpdate(
                    name=args.name,
                    token_amount=args.tokens,
                    is_active=active,
                    notes=args.notes,
                ),
            )
            print(f"updated package {result.id} {result.name} tokens={result.token_amount} active={result.is_active}")
            return

        if args.command == "package-list":
            packages = await redemption_service.list_packages(session)
            for package in packages:
                print(f"{package.id}\t{package.name}\t{package.token_amount}\tactive={package.is_active}")
            return

        if args.command == "batch-generate":
            result = await redemption_service.create_redemption_batch(
                session,
                created_by=args.created_by,
                payload=RedemptionBatchCreate(
                    package_id=args.package_id,
                    name=args.name,
                    channel=args.channel,
                    count=args.count,
                ),
            )
            if args.output:
                path = Path(args.output)
                path.write_text("\n".join(result.codes) + "\n", encoding="utf-8")
                print(f"generated batch {result.batch.id}; wrote {len(result.codes)} codes to {path}")
            else:
                print(f"generated batch {result.batch.id}")
                for code in result.codes:
                    print(code)
            return

        if args.command == "batch-export":
            csv_text = await redemption_service.export_batch_csv(session, args.batch_id)
            path = Path(args.output)
            path.write_text(csv_text, encoding="utf-8")
            print(f"exported batch {args.batch_id} to {path}")
            return

        if args.command == "batch-revoke":
            result = await redemption_service.revoke_batch(session, args.batch_id, args.revoked_by)
            print(f"revoked {result.revoked_count} unused codes in batch {result.batch.id}")
            return

        if args.command == "code-revoke":
            result = await redemption_service.revoke_code_response(session, args.code_id, args.revoked_by)
            print(f"revoked code {result.code.id} status={result.code.status}")
            return


def main() -> None:
    parser = _build_parser()
    args = parser.parse_args()
    asyncio.run(_run(args))


if __name__ == "__main__":
    main()
