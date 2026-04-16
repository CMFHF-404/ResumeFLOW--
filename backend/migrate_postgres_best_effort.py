import asyncio
import os
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path

import asyncpg
from dotenv import load_dotenv

ENV_FILE_NAME = ".env"
ENV_SOURCE_DATABASE_URL = "SOURCE_DATABASE_URL"
ENV_TARGET_DATABASE_URL = "TARGET_DATABASE_URL"
SQLALCHEMY_ASYNCPG_PREFIX = "postgresql+asyncpg://"
POSTGRES_PREFIX = "postgresql://"
SYSTEM_SCHEMAS = {
    "information_schema",
    "pg_catalog",
}
SYSTEM_SCHEMA_PREFIXES = (
    "pg_toast",
    "pg_temp_",
    "pg_toast_temp_",
)
DATA_BATCH_SIZE = 1000


@dataclass
class ColumnDef:
    name: str
    data_type: str
    not_null: bool
    default_expr: str | None
    identity: str
    generated: str


@dataclass
class TableDef:
    schema: str
    name: str
    relkind: str
    is_partition: bool
    partition_key: str | None
    partition_bound: str | None
    parent_schema: str | None
    parent_name: str | None
    columns: list[ColumnDef]


@dataclass
class EnumDef:
    schema: str
    name: str
    labels: list[str]


@dataclass
class CompositeFieldDef:
    name: str
    data_type: str


@dataclass
class CompositeTypeDef:
    schema: str
    name: str
    fields: list[CompositeFieldDef]


@dataclass
class FunctionDef:
    schema: str
    name: str
    prokind: str
    identity_args: str
    ddl: str


@dataclass
class AggregateDef:
    schema: str
    name: str
    identity_args: str
    ddl: str


@dataclass
class OperatorDef:
    schema: str
    name: str
    left_type: str | None
    right_type: str | None
    ddl: str


@dataclass
class OperatorFamilyDef:
    schema: str
    name: str
    index_method: str
    ddl: str


@dataclass
class OperatorClassDef:
    schema: str
    name: str
    index_method: str
    input_type: str
    ddl: str


@dataclass
class OperatorFamilyMemberDef:
    family_schema: str
    family_name: str
    index_method: str
    sort_key: tuple[object, ...]
    ddl: str
    drop_ddl: str


@dataclass
class SequenceDef:
    schema: str
    name: str
    data_type: str
    start_value: int
    min_value: int | None
    max_value: int | None
    increment_by: int
    cache_size: int
    cycle: bool


def _load_env_file() -> None:
    env_path = Path(__file__).resolve().parent / ENV_FILE_NAME
    if env_path.exists():
        load_dotenv(env_path)


def _normalize_database_url(database_url: str) -> str:
    if database_url.startswith(SQLALCHEMY_ASYNCPG_PREFIX):
        return POSTGRES_PREFIX + database_url[len(SQLALCHEMY_ASYNCPG_PREFIX) :]
    return database_url


def _get_required_env(name: str) -> str:
    value = os.getenv(name)
    if not value:
        raise RuntimeError(f"缺少环境变量: {name}")
    return _normalize_database_url(value)


def _quote_ident(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def _quote_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _qualify(schema: str, name: str) -> str:
    return f"{_quote_ident(schema)}.{_quote_ident(name)}"


def _is_user_schema(schema_name: str) -> bool:
    if schema_name in SYSTEM_SCHEMAS:
        return False
    return not any(schema_name.startswith(prefix) for prefix in SYSTEM_SCHEMA_PREFIXES)


def _normalize_pg_flag(value: bytes | str | None) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        if value in (b"\x00", b""):
            return ""
        return value.decode("utf-8")
    return value


def _normalize_reg_name(value: str | None) -> str | None:
    if not value or value == "-":
        return None
    return value


def _normalize_parallel(value: str) -> str:
    return {
        "s": "SAFE",
        "r": "RESTRICTED",
        "u": "UNSAFE",
    }.get(value, "UNSAFE")


def _normalize_aggregate_modify(value: str | None) -> str | None:
    if not value:
        return None
    return {
        "r": "READ_ONLY",
        "s": "SHAREABLE",
        "w": "READ_WRITE",
    }.get(value)


def _qualify_operator(schema: str, operator_name: str) -> str:
    return f"{_quote_ident(schema)}.{operator_name}"


def _format_operator_reference(schema: str | None, operator_name: str | None) -> str | None:
    if not schema or not operator_name:
        return None
    if schema == "pg_catalog":
        return operator_name
    return f"OPERATOR({_quote_ident(schema)}.{operator_name})"


def _format_operator_operand(type_name: str | None) -> str:
    return type_name if type_name is not None else "NONE"


def _qualify_family(schema: str, name: str) -> str:
    return _qualify(schema, name)


def _format_opclass_item_types(left_type: str | None, right_type: str | None) -> str:
    item_types = [type_name for type_name in (left_type, right_type) if type_name is not None]
    if not item_types:
        return ""
    return f" ({', '.join(item_types)})"


def _format_function_signature(schema: str, name: str, identity_args: str) -> str:
    return f"{_qualify(schema, name)}({identity_args})"


async def _connect(label: str, dsn: str, retries: int = 6) -> asyncpg.Connection:
    last_error: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            return await asyncpg.connect(
                dsn,
                timeout=120,
                command_timeout=300,
                statement_cache_size=0,
            )
        except Exception as exc:  # pragma: no cover - operational retry
            last_error = exc
            wait_seconds = min(2**attempt, 20)
            print(f"[{label}] 连接失败（第 {attempt}/{retries} 次），{wait_seconds}s 后重试: {exc}")
            await asyncio.sleep(wait_seconds)
    raise RuntimeError(f"[{label}] 连接失败") from last_error


async def _fetch_source_schemas(source: asyncpg.Connection) -> list[str]:
    rows = await source.fetch(
        """
        select nspname
        from pg_namespace
        where nspname not in ('pg_catalog', 'information_schema')
          and nspname not like 'pg_toast%'
          and nspname not like 'pg_temp_%'
          and nspname not like 'pg_toast_temp_%'
        order by nspname
        """
    )
    return [row["nspname"] for row in rows if _is_user_schema(row["nspname"])]


async def _fetch_user_schemas(conn: asyncpg.Connection) -> list[str]:
    return await _fetch_source_schemas(conn)


async def _fetch_extensions(source: asyncpg.Connection) -> list[tuple[str, str]]:
    rows = await source.fetch(
        """
        select e.extname, n.nspname as schema_name
        from pg_extension e
        join pg_namespace n on n.oid = e.extnamespace
        where e.extname <> 'plpgsql'
        order by e.extname
        """
    )
    return [(row["extname"], row["schema_name"]) for row in rows]


async def _fetch_enums(source: asyncpg.Connection) -> list[EnumDef]:
    rows = await source.fetch(
        """
        select n.nspname as schema_name,
               t.typname as type_name,
               array_agg(e.enumlabel order by e.enumsortorder) as labels
        from pg_type t
        join pg_namespace n on n.oid = t.typnamespace
        join pg_enum e on e.enumtypid = t.oid
        left join pg_depend d
          on d.classid = 'pg_type'::regclass
         and d.objid = t.oid
         and d.deptype = 'e'
        where n.nspname not in ('pg_catalog', 'information_schema')
          and d.objid is null
        group by n.nspname, t.typname
        order by n.nspname, t.typname
        """
    )
    return [
        EnumDef(schema=row["schema_name"], name=row["type_name"], labels=list(row["labels"]))
        for row in rows
        if _is_user_schema(row["schema_name"])
    ]


async def _fetch_sequences(source: asyncpg.Connection) -> list[SequenceDef]:
    rows = await source.fetch(
        """
        select n.nspname as schema_name,
               c.relname as sequence_name,
               pg_catalog.format_type(s.seqtypid, null) as data_type,
               s.seqstart as start_value,
               s.seqmin as min_value,
               s.seqmax as max_value,
               s.seqincrement as increment_by,
               s.seqcache as cache_size,
               s.seqcycle as cycle
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        join pg_sequence s on s.seqrelid = c.oid
        left join pg_depend d
          on d.classid = 'pg_class'::regclass
         and d.objid = c.oid
         and d.deptype = 'e'
        where c.relkind = 'S'
          and n.nspname not in ('pg_catalog', 'information_schema')
          and d.objid is null
        order by n.nspname, c.relname
        """
    )
    return [
        SequenceDef(
            schema=row["schema_name"],
            name=row["sequence_name"],
            data_type=row["data_type"],
            start_value=row["start_value"],
            min_value=row["min_value"],
            max_value=row["max_value"],
            increment_by=row["increment_by"],
            cache_size=row["cache_size"],
            cycle=row["cycle"],
        )
        for row in rows
        if _is_user_schema(row["schema_name"])
    ]


async def _fetch_composite_types(source: asyncpg.Connection) -> list[CompositeTypeDef]:
    rows = await source.fetch(
        """
        select n.nspname as schema_name,
               t.typname as type_name,
               a.attnum,
               a.attname as field_name,
               pg_catalog.format_type(a.atttypid, a.atttypmod) as data_type
        from pg_type t
        join pg_namespace n on n.oid = t.typnamespace
        join pg_class c on c.oid = t.typrelid
        join pg_attribute a on a.attrelid = c.oid
        left join pg_depend d
          on d.classid = 'pg_type'::regclass
         and d.objid = t.oid
         and d.deptype = 'e'
        where t.typtype = 'c'
          and c.relkind = 'c'
          and a.attnum > 0
          and not a.attisdropped
          and n.nspname not in ('pg_catalog', 'information_schema')
          and d.objid is null
        order by n.nspname, t.typname, a.attnum
        """
    )
    grouped: dict[tuple[str, str], list[CompositeFieldDef]] = defaultdict(list)
    for row in rows:
        schema_name = row["schema_name"]
        if not _is_user_schema(schema_name):
            continue
        grouped[(schema_name, row["type_name"])].append(
            CompositeFieldDef(name=row["field_name"], data_type=row["data_type"])
        )
    return [
        CompositeTypeDef(schema=schema, name=type_name, fields=fields)
        for (schema, type_name), fields in grouped.items()
    ]


async def _fetch_tables(source: asyncpg.Connection) -> list[TableDef]:
    rows = await source.fetch(
        """
        select n.nspname as schema_name,
               c.relname as table_name,
               c.relkind,
               c.relispartition,
               pg_get_partkeydef(c.oid) as partition_key,
               pg_get_expr(c.relpartbound, c.oid) as partition_bound,
               pn.nspname as parent_schema,
               pc.relname as parent_name,
               a.attnum,
               a.attname as column_name,
               pg_catalog.format_type(a.atttypid, a.atttypmod) as data_type,
               a.attnotnull,
               pg_get_expr(ad.adbin, ad.adrelid) as default_expr,
               a.attidentity,
               a.attgenerated
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        left join pg_inherits i on i.inhrelid = c.oid
        left join pg_class pc on pc.oid = i.inhparent
        left join pg_namespace pn on pn.oid = pc.relnamespace
        join pg_attribute a on a.attrelid = c.oid
        left join pg_attrdef ad on ad.adrelid = c.oid and ad.adnum = a.attnum
        left join pg_depend d
          on d.classid = 'pg_class'::regclass
         and d.objid = c.oid
         and d.deptype = 'e'
        where c.relkind in ('r', 'p')
          and a.attnum > 0
          and not a.attisdropped
          and n.nspname not in ('pg_catalog', 'information_schema')
          and d.objid is null
        order by n.nspname, c.relname, a.attnum
        """
    )
    grouped: dict[tuple[str, str], list[ColumnDef]] = defaultdict(list)
    table_meta: dict[tuple[str, str], tuple[str, bool, str | None, str | None, str | None, str | None]] = {}
    for row in rows:
        schema_name = row["schema_name"]
        if not _is_user_schema(schema_name):
            continue
        table_key = (schema_name, row["table_name"])
        table_meta[table_key] = (
            _normalize_pg_flag(row["relkind"]),
            bool(row["relispartition"]),
            row["partition_key"],
            row["partition_bound"],
            row["parent_schema"],
            row["parent_name"],
        )
        grouped[table_key].append(
            ColumnDef(
                name=row["column_name"],
                data_type=row["data_type"],
                not_null=row["attnotnull"],
                default_expr=row["default_expr"],
                identity=_normalize_pg_flag(row["attidentity"]),
                generated=_normalize_pg_flag(row["attgenerated"]),
            )
        )
    return [
        TableDef(
            schema=schema,
            name=table,
            relkind=table_meta[(schema, table)][0],
            is_partition=table_meta[(schema, table)][1],
            partition_key=table_meta[(schema, table)][2],
            partition_bound=table_meta[(schema, table)][3],
            parent_schema=table_meta[(schema, table)][4],
            parent_name=table_meta[(schema, table)][5],
            columns=columns,
        )
        for (schema, table), columns in grouped.items()
    ]


async def _fetch_constraints(source: asyncpg.Connection) -> tuple[list[tuple[str, str, str, str]], list[tuple[str, str, str, str]]]:
    rows = await source.fetch(
        """
        select n.nspname as schema_name,
               c.relname as table_name,
               con.conname as constraint_name,
               con.contype,
               pg_get_constraintdef(con.oid, true) as definition
        from pg_constraint con
        join pg_class c on c.oid = con.conrelid
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname not in ('pg_catalog', 'information_schema')
        order by n.nspname, c.relname, con.conname
        """
    )
    regular: list[tuple[str, str, str, str]] = []
    foreign_keys: list[tuple[str, str, str, str]] = []
    for row in rows:
        schema_name = row["schema_name"]
        if not _is_user_schema(schema_name):
            continue
        item = (
            schema_name,
            row["table_name"],
            row["constraint_name"],
            row["definition"],
        )
        if _normalize_pg_flag(row["contype"]) == "f":
            foreign_keys.append(item)
        else:
            regular.append(item)
    return regular, foreign_keys


async def _fetch_indexes(source: asyncpg.Connection) -> list[tuple[str, str, str]]:
    rows = await source.fetch(
        """
        select n.nspname as schema_name,
               tbl.relname as table_name,
               pg_get_indexdef(idx.oid) as ddl
        from pg_index i
        join pg_class idx on idx.oid = i.indexrelid
        join pg_class tbl on tbl.oid = i.indrelid
        join pg_namespace n on n.oid = tbl.relnamespace
        left join pg_constraint con on con.conindid = idx.oid
        left join pg_depend d
          on d.classid = 'pg_class'::regclass
         and d.objid = idx.oid
         and d.deptype = 'e'
        where n.nspname not in ('pg_catalog', 'information_schema')
          and not i.indisprimary
          and con.oid is null
          and d.objid is null
        order by n.nspname, tbl.relname, idx.relname
        """
    )
    return [
        (row["schema_name"], row["table_name"], row["ddl"])
        for row in rows
        if _is_user_schema(row["schema_name"])
    ]


async def _fetch_functions(source: asyncpg.Connection) -> list[FunctionDef]:
    rows = await source.fetch(
        """
        select n.nspname as schema_name,
               p.proname as function_name,
               p.prokind,
               pg_get_function_identity_arguments(p.oid) as identity_args,
               pg_get_functiondef(p.oid) as ddl
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        left join pg_depend d
          on d.classid = 'pg_proc'::regclass
         and d.objid = p.oid
         and d.deptype = 'e'
        where n.nspname not in ('pg_catalog', 'information_schema')
          and p.prokind in ('f', 'p')
          and d.objid is null
        order by n.nspname, p.proname
        """
    )
    return [
        FunctionDef(
            schema=row["schema_name"],
            name=row["function_name"],
            prokind=_normalize_pg_flag(row["prokind"]),
            identity_args=row["identity_args"],
            ddl=row["ddl"],
        )
        for row in rows
        if _is_user_schema(row["schema_name"])
    ]


async def _fetch_aggregates(source: asyncpg.Connection) -> list[AggregateDef]:
    rows = await source.fetch(
        """
        select n.nspname as schema_name,
               p.proname as aggregate_name,
               pg_get_function_identity_arguments(p.oid) as identity_args,
               p.proparallel,
               a.aggkind,
               a.aggtransfn::regproc::text as sfunc,
               a.aggtranstype::regtype::text as stype,
               a.aggtransspace,
               a.aggfinalfn::regproc::text as finalfunc,
               a.aggfinalextra,
               a.aggfinalmodify,
               a.aggcombinefn::regproc::text as combinefunc,
               a.aggserialfn::regproc::text as serialfunc,
               a.aggdeserialfn::regproc::text as deserialfunc,
               a.aggmtransfn::regproc::text as msfunc,
               a.aggminvtransfn::regproc::text as minvfunc,
               a.aggmtranstype::regtype::text as mstype,
               a.aggmtransspace,
               a.aggmfinalfn::regproc::text as mfinalfunc,
               a.aggmfinalextra,
               a.aggmfinalmodify,
               case
                   when a.aggsortop = 0 then null
                   else
                       case
                           when onsp.nspname = 'pg_catalog' then oop.oprname
                           else 'OPERATOR(' || quote_ident(onsp.nspname) || '.' || oop.oprname || ')'
                       end
               end as sortop,
               a.agginitval,
               a.aggminitval
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        join pg_aggregate a on a.aggfnoid = p.oid
        left join pg_operator oop on oop.oid = a.aggsortop
        left join pg_namespace onsp on onsp.oid = oop.oprnamespace
        left join pg_depend d
          on d.classid = 'pg_proc'::regclass
         and d.objid = p.oid
         and d.deptype = 'e'
        where n.nspname not in ('pg_catalog', 'information_schema')
          and d.objid is null
        order by n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)
        """
    )
    aggregates: list[AggregateDef] = []
    for row in rows:
        schema_name = row["schema_name"]
        if not _is_user_schema(schema_name):
            continue

        options = [
            f"SFUNC = {row['sfunc']}",
            f"STYPE = {row['stype']}",
        ]
        if row["aggtransspace"]:
            options.append(f"SSPACE = {row['aggtransspace']}")

        finalfunc = _normalize_reg_name(row["finalfunc"])
        if finalfunc:
            options.append(f"FINALFUNC = {finalfunc}")
            if row["aggfinalextra"]:
                options.append("FINALFUNC_EXTRA")
            finalmodify = _normalize_aggregate_modify(_normalize_pg_flag(row["aggfinalmodify"]))
            if finalmodify:
                options.append(f"FINALFUNC_MODIFY = {finalmodify}")

        combinefunc = _normalize_reg_name(row["combinefunc"])
        if combinefunc:
            options.append(f"COMBINEFUNC = {combinefunc}")

        serialfunc = _normalize_reg_name(row["serialfunc"])
        if serialfunc:
            options.append(f"SERIALFUNC = {serialfunc}")

        deserialfunc = _normalize_reg_name(row["deserialfunc"])
        if deserialfunc:
            options.append(f"DESERIALFUNC = {deserialfunc}")

        msfunc = _normalize_reg_name(row["msfunc"])
        if msfunc:
            options.append(f"MSFUNC = {msfunc}")

        minvfunc = _normalize_reg_name(row["minvfunc"])
        if minvfunc:
            options.append(f"MINVFUNC = {minvfunc}")

        mstype = _normalize_reg_name(row["mstype"])
        if mstype:
            options.append(f"MSTYPE = {mstype}")
        if row["aggmtransspace"]:
            options.append(f"MSSPACE = {row['aggmtransspace']}")

        mfinalfunc = _normalize_reg_name(row["mfinalfunc"])
        if mfinalfunc:
            options.append(f"MFINALFUNC = {mfinalfunc}")
            if row["aggmfinalextra"]:
                options.append("MFINALFUNC_EXTRA")
            mfinalmodify = _normalize_aggregate_modify(_normalize_pg_flag(row["aggmfinalmodify"]))
            if mfinalmodify:
                options.append(f"MFINALFUNC_MODIFY = {mfinalmodify}")

        if row["sortop"]:
            options.append(f"SORTOP = {row['sortop']}")
        if row["agginitval"] is not None:
            options.append(f"INITCOND = {_quote_literal(row['agginitval'])}")
        if row["aggminitval"] is not None:
            options.append(f"MINITCOND = {_quote_literal(row['aggminitval'])}")

        options.append(f"PARALLEL = {_normalize_parallel(_normalize_pg_flag(row['proparallel']))}")
        if _normalize_pg_flag(row["aggkind"]) == "h":
            options.append("HYPOTHETICAL")

        ddl = (
            f"CREATE AGGREGATE {_qualify(schema_name, row['aggregate_name'])} "
            f"({row['identity_args']}) (\n    "
            + ",\n    ".join(options)
            + "\n)"
        )
        aggregates.append(
            AggregateDef(
                schema=schema_name,
                name=row["aggregate_name"],
                identity_args=row["identity_args"],
                ddl=ddl,
            )
        )
    return aggregates


async def _fetch_operators(source: asyncpg.Connection) -> list[OperatorDef]:
    rows = await source.fetch(
        """
        select n.nspname as schema_name,
               o.oprname as operator_name,
               case when o.oprleft = 0 then null else o.oprleft::regtype::text end as left_type,
               case when o.oprright = 0 then null else o.oprright::regtype::text end as right_type,
               o.oprcode::regproc::text as function_name,
               cn.nspname as commutator_schema,
               co.oprname as commutator_name,
               nn.nspname as negator_schema,
               no.oprname as negator_name,
               case when o.oprrest = 0 then null else o.oprrest::regproc::text end as restrict_proc,
               case when o.oprjoin = 0 then null else o.oprjoin::regproc::text end as join_proc,
               o.oprcanhash,
               o.oprcanmerge
        from pg_operator o
        join pg_namespace n on n.oid = o.oprnamespace
        left join pg_operator co on co.oid = o.oprcom
        left join pg_namespace cn on cn.oid = co.oprnamespace
        left join pg_operator no on no.oid = o.oprnegate
        left join pg_namespace nn on nn.oid = no.oprnamespace
        left join pg_depend d
          on d.classid = 'pg_operator'::regclass
         and d.objid = o.oid
         and d.deptype = 'e'
        where n.nspname not in ('pg_catalog', 'information_schema')
          and o.oprcode <> 0
          and d.objid is null
        order by n.nspname, o.oprname, o.oprleft, o.oprright
        """
    )
    operators: list[OperatorDef] = []
    for row in rows:
        schema_name = row["schema_name"]
        if not _is_user_schema(schema_name):
            continue

        clauses = [f"FUNCTION = {row['function_name']}"]
        if row["left_type"] is not None:
            clauses.append(f"LEFTARG = {row['left_type']}")
        if row["right_type"] is not None:
            clauses.append(f"RIGHTARG = {row['right_type']}")

        commutator = _format_operator_reference(row["commutator_schema"], row["commutator_name"])
        if commutator:
            clauses.append(f"COMMUTATOR = {commutator}")

        negator = _format_operator_reference(row["negator_schema"], row["negator_name"])
        if negator:
            clauses.append(f"NEGATOR = {negator}")

        if row["restrict_proc"]:
            clauses.append(f"RESTRICT = {row['restrict_proc']}")
        if row["join_proc"]:
            clauses.append(f"JOIN = {row['join_proc']}")
        if row["oprcanhash"]:
            clauses.append("HASHES")
        if row["oprcanmerge"]:
            clauses.append("MERGES")

        ddl = (
            f"CREATE OPERATOR {_qualify_operator(schema_name, row['operator_name'])} (\n    "
            + ",\n    ".join(clauses)
            + "\n)"
        )
        operators.append(
            OperatorDef(
                schema=schema_name,
                name=row["operator_name"],
                left_type=row["left_type"],
                right_type=row["right_type"],
                ddl=ddl,
            )
        )
    return operators


async def _fetch_operator_families(source: asyncpg.Connection) -> list[OperatorFamilyDef]:
    rows = await source.fetch(
        """
        select n.nspname as schema_name,
               o.opfname as family_name,
               am.amname as method_name
        from pg_opfamily o
        join pg_namespace n on n.oid = o.opfnamespace
        join pg_am am on am.oid = o.opfmethod
        left join pg_depend d
          on d.classid = 'pg_opfamily'::regclass
         and d.objid = o.oid
         and d.deptype = 'e'
        where n.nspname not in ('pg_catalog', 'information_schema')
          and d.objid is null
        order by n.nspname, o.opfname, am.amname
        """
    )
    return [
        OperatorFamilyDef(
            schema=row["schema_name"],
            name=row["family_name"],
            index_method=row["method_name"],
            ddl=(
                f"CREATE OPERATOR FAMILY {_qualify(row['schema_name'], row['family_name'])} "
                f"USING {_quote_ident(row['method_name'])}"
            ),
        )
        for row in rows
        if _is_user_schema(row["schema_name"])
    ]


async def _fetch_operator_classes(source: asyncpg.Connection) -> list[OperatorClassDef]:
    rows = await source.fetch(
        """
        select c.oid as opclass_oid,
               n.nspname as schema_name,
               c.opcname as class_name,
               am.amname as method_name,
               c.opcdefault,
               c.opcintype::regtype::text as input_type,
               case when c.opckeytype = 0 then null else c.opckeytype::regtype::text end as key_type,
               fn.nspname as family_schema,
               f.opfname as family_name
        from pg_opclass c
        join pg_namespace n on n.oid = c.opcnamespace
        join pg_am am on am.oid = c.opcmethod
        join pg_opfamily f on f.oid = c.opcfamily
        join pg_namespace fn on fn.oid = f.opfnamespace
        left join pg_depend d
          on d.classid = 'pg_opclass'::regclass
         and d.objid = c.oid
         and d.deptype = 'e'
        where n.nspname not in ('pg_catalog', 'information_schema')
          and d.objid is null
        order by n.nspname, c.opcname, am.amname
        """
    )
    operator_classes: list[OperatorClassDef] = []
    for row in rows:
        schema_name = row["schema_name"]
        if not _is_user_schema(schema_name):
            continue

        operator_rows = await source.fetch(
            """
            select distinct a.amopstrategy,
                   a.amoppurpose,
                   a.amoplefttype::regtype::text as left_type,
                   a.amoprighttype::regtype::text as right_type,
                   onsp.nspname as operator_schema,
                   oop.oprname as operator_name,
                   sf_n.nspname as sort_family_schema,
                   sf.opfname as sort_family_name
            from pg_amop a
            join pg_operator oop on oop.oid = a.amopopr
            join pg_namespace onsp on onsp.oid = oop.oprnamespace
            join pg_depend d
              on d.classid = 'pg_amop'::regclass
             and d.objid = a.oid
             and d.refclassid = 'pg_opclass'::regclass
             and d.refobjid = $1
            left join pg_opfamily sf on sf.oid = a.amopsortfamily
            left join pg_namespace sf_n on sf_n.oid = sf.opfnamespace
            order by a.amopstrategy, onsp.nspname, oop.oprname, a.amoplefttype, a.amoprighttype
            """,
            row["opclass_oid"],
        )
        function_rows = await source.fetch(
            """
            select distinct a.amprocnum,
                   a.amproclefttype::regtype::text as left_type,
                   a.amprocrighttype::regtype::text as right_type,
                   pn.nspname as function_schema,
                   p.proname as function_name,
                   pg_get_function_identity_arguments(p.oid) as identity_args
            from pg_amproc a
            join pg_proc p on p.oid = a.amproc
            join pg_namespace pn on pn.oid = p.pronamespace
            join pg_depend d
              on d.classid = 'pg_amproc'::regclass
             and d.objid = a.oid
             and d.refclassid = 'pg_opclass'::regclass
             and d.refobjid = $1
            order by a.amprocnum, pn.nspname, p.proname, a.amproclefttype, a.amprocrighttype
            """,
            row["opclass_oid"],
        )

        items: list[str] = []
        for operator_row in operator_rows:
            operator_item = (
                f"OPERATOR {operator_row['amopstrategy']} "
                f"{_format_operator_reference(operator_row['operator_schema'], operator_row['operator_name'])}"
                f"{_format_opclass_item_types(operator_row['left_type'], operator_row['right_type'])}"
            )
            if _normalize_pg_flag(operator_row["amoppurpose"]) == "o":
                operator_item += (
                    f" FOR ORDER BY "
                    f"{_qualify_family(operator_row['sort_family_schema'], operator_row['sort_family_name'])}"
                )
            items.append(operator_item)

        for function_row in function_rows:
            items.append(
                f"FUNCTION {function_row['amprocnum']}"
                f"{_format_opclass_item_types(function_row['left_type'], function_row['right_type'])} "
                f"{_format_function_signature(function_row['function_schema'], function_row['function_name'], function_row['identity_args'])}"
            )

        key_type = row["key_type"]
        if key_type and key_type != row["input_type"]:
            items.append(f"STORAGE {key_type}")

        default_clause = " DEFAULT" if row["opcdefault"] else ""
        ddl = (
            f"CREATE OPERATOR CLASS {_qualify(schema_name, row['class_name'])}{default_clause} "
            f"FOR TYPE {row['input_type']} USING {_quote_ident(row['method_name'])} "
            f"FAMILY {_qualify_family(row['family_schema'], row['family_name'])} AS\n    "
            + ",\n    ".join(items)
        )
        operator_classes.append(
            OperatorClassDef(
                schema=schema_name,
                name=row["class_name"],
                index_method=row["method_name"],
                input_type=row["input_type"],
                ddl=ddl,
            )
        )
    return operator_classes


async def _fetch_operator_family_members(source: asyncpg.Connection) -> list[OperatorFamilyMemberDef]:
    operator_rows = await source.fetch(
        """
        select n.nspname as family_schema,
               f.opfname as family_name,
               am.amname as method_name,
               a.amopstrategy,
               a.amoppurpose,
               a.amoplefttype::regtype::text as left_type,
               a.amoprighttype::regtype::text as right_type,
               onsp.nspname as operator_schema,
               oop.oprname as operator_name,
               sf_n.nspname as sort_family_schema,
               sf.opfname as sort_family_name
        from pg_amop a
        join pg_opfamily f on f.oid = a.amopfamily
        join pg_namespace n on n.oid = f.opfnamespace
        join pg_am am on am.oid = f.opfmethod
        join pg_operator oop on oop.oid = a.amopopr
        join pg_namespace onsp on onsp.oid = oop.oprnamespace
        left join pg_opfamily sf on sf.oid = a.amopsortfamily
        left join pg_namespace sf_n on sf_n.oid = sf.opfnamespace
        left join pg_depend ext_d
          on ext_d.classid = 'pg_amop'::regclass
         and ext_d.objid = a.oid
         and ext_d.deptype = 'e'
        left join pg_depend class_d
          on class_d.classid = 'pg_amop'::regclass
         and class_d.objid = a.oid
         and class_d.refclassid = 'pg_opclass'::regclass
        where n.nspname not in ('pg_catalog', 'information_schema')
          and ext_d.objid is null
          and class_d.objid is null
        order by n.nspname, f.opfname, am.amname, a.amopstrategy, onsp.nspname, oop.oprname
        """
    )
    function_rows = await source.fetch(
        """
        select n.nspname as family_schema,
               f.opfname as family_name,
               am.amname as method_name,
               a.amprocnum,
               a.amproclefttype::regtype::text as left_type,
               a.amprocrighttype::regtype::text as right_type,
               pn.nspname as function_schema,
               p.proname as function_name,
               pg_get_function_identity_arguments(p.oid) as identity_args
        from pg_amproc a
        join pg_opfamily f on f.oid = a.amprocfamily
        join pg_namespace n on n.oid = f.opfnamespace
        join pg_am am on am.oid = f.opfmethod
        join pg_proc p on p.oid = a.amproc
        join pg_namespace pn on pn.oid = p.pronamespace
        left join pg_depend ext_d
          on ext_d.classid = 'pg_amproc'::regclass
         and ext_d.objid = a.oid
         and ext_d.deptype = 'e'
        left join pg_depend class_d
          on class_d.classid = 'pg_amproc'::regclass
         and class_d.objid = a.oid
         and class_d.refclassid = 'pg_opclass'::regclass
        where n.nspname not in ('pg_catalog', 'information_schema')
          and ext_d.objid is null
          and class_d.objid is null
        order by n.nspname, f.opfname, am.amname, a.amprocnum, pn.nspname, p.proname
        """
    )

    members: list[OperatorFamilyMemberDef] = []
    for row in operator_rows:
        if not _is_user_schema(row["family_schema"]):
            continue
        operator_ref = _format_operator_reference(row["operator_schema"], row["operator_name"])
        operand_types = _format_opclass_item_types(row["left_type"], row["right_type"])
        ddl = (
            f"ALTER OPERATOR FAMILY {_qualify(row['family_schema'], row['family_name'])} "
            f"USING {_quote_ident(row['method_name'])} ADD\n    "
            f"OPERATOR {row['amopstrategy']} "
            f"{operator_ref}{operand_types}"
        )
        if _normalize_pg_flag(row["amoppurpose"]) == "o":
            ddl += (
                f" FOR ORDER BY "
                f"{_qualify_family(row['sort_family_schema'], row['sort_family_name'])}"
            )
        drop_ddl = (
            f"ALTER OPERATOR FAMILY {_qualify(row['family_schema'], row['family_name'])} "
            f"USING {_quote_ident(row['method_name'])} DROP\n    "
            f"OPERATOR {row['amopstrategy']} {operator_ref}{operand_types}"
        )
        if _normalize_pg_flag(row["amoppurpose"]) == "o":
            drop_ddl += (
                f" FOR ORDER BY "
                f"{_qualify_family(row['sort_family_schema'], row['sort_family_name'])}"
            )
        members.append(
            OperatorFamilyMemberDef(
                family_schema=row["family_schema"],
                family_name=row["family_name"],
                index_method=row["method_name"],
                sort_key=(
                    0,
                    row["amopstrategy"],
                    row["operator_schema"],
                    row["operator_name"],
                    row["left_type"],
                    row["right_type"],
                    row["sort_family_schema"],
                    row["sort_family_name"],
                    _normalize_pg_flag(row["amoppurpose"]),
                ),
                ddl=ddl,
                drop_ddl=drop_ddl,
            )
        )

    for row in function_rows:
        if not _is_user_schema(row["family_schema"]):
            continue
        operand_types = _format_opclass_item_types(row["left_type"], row["right_type"])
        function_sig = _format_function_signature(row["function_schema"], row["function_name"], row["identity_args"])
        ddl = (
            f"ALTER OPERATOR FAMILY {_qualify(row['family_schema'], row['family_name'])} "
            f"USING {_quote_ident(row['method_name'])} ADD\n    "
            f"FUNCTION {row['amprocnum']}{operand_types} {function_sig}"
        )
        drop_ddl = (
            f"ALTER OPERATOR FAMILY {_qualify(row['family_schema'], row['family_name'])} "
            f"USING {_quote_ident(row['method_name'])} DROP\n    "
            f"FUNCTION {row['amprocnum']}{operand_types} {function_sig}"
        )
        members.append(
            OperatorFamilyMemberDef(
                family_schema=row["family_schema"],
                family_name=row["family_name"],
                index_method=row["method_name"],
                sort_key=(
                    1,
                    row["amprocnum"],
                    row["function_schema"],
                    row["function_name"],
                    row["identity_args"],
                    row["left_type"],
                    row["right_type"],
                ),
                ddl=ddl,
                drop_ddl=drop_ddl,
            )
        )

    members.sort(key=lambda item: (item.family_schema, item.family_name, item.index_method, item.sort_key))
    return members


async def _fetch_views(source: asyncpg.Connection) -> list[tuple[str, str, str]]:
    rows = await source.fetch(
        """
        select n.nspname as schema_name,
               c.relname as view_name,
               pg_get_viewdef(c.oid, true) as definition
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        left join pg_depend d
          on d.classid = 'pg_class'::regclass
         and d.objid = c.oid
         and d.deptype = 'e'
        where c.relkind = 'v'
          and n.nspname not in ('pg_catalog', 'information_schema')
          and d.objid is null
        order by n.nspname, c.relname
        """
    )
    return [
        (row["schema_name"], row["view_name"], row["definition"])
        for row in rows
        if _is_user_schema(row["schema_name"])
    ]


async def _fetch_triggers(source: asyncpg.Connection) -> list[tuple[str, str, str]]:
    rows = await source.fetch(
        """
        select n.nspname as schema_name,
               c.relname as table_name,
               pg_get_triggerdef(t.oid, true) as ddl
        from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
        join pg_namespace n on n.oid = c.relnamespace
        left join pg_depend d
          on d.classid = 'pg_trigger'::regclass
         and d.objid = t.oid
         and d.deptype = 'e'
        where not t.tgisinternal
          and n.nspname not in ('pg_catalog', 'information_schema')
          and d.objid is null
        order by n.nspname, c.relname, t.tgname
        """
    )
    return [
        (row["schema_name"], row["table_name"], row["ddl"])
        for row in rows
        if _is_user_schema(row["schema_name"])
    ]


def _build_create_table_sql(table: TableDef) -> str:
    column_sql: list[str] = []
    for column in table.columns:
        parts = [f"{_quote_ident(column.name)} {column.data_type}"]
        if column.generated:
            generated_mode = "STORED" if column.generated == "s" else ""
            if not column.default_expr:
                raise RuntimeError(f"{table.schema}.{table.name}.{column.name} 缺少生成列表达式")
            parts.append(f"GENERATED ALWAYS AS ({column.default_expr}) {generated_mode}".strip())
        elif column.identity:
            identity_mode = "ALWAYS" if column.identity == "a" else "BY DEFAULT"
            parts.append(f"GENERATED {identity_mode} AS IDENTITY")
        elif column.default_expr:
            parts.append(f"DEFAULT {column.default_expr}")
        if column.not_null:
            parts.append("NOT NULL")
        column_sql.append(" ".join(parts))
    joined = ",\n    ".join(column_sql)
    if table.is_partition:
        if not table.parent_schema or not table.parent_name or not table.partition_bound:
            raise RuntimeError(f"{table.schema}.{table.name} 缺少分区定义")
        sql = (
            f"CREATE TABLE {_qualify(table.schema, table.name)} "
            f"PARTITION OF {_qualify(table.parent_schema, table.parent_name)} "
            f"{table.partition_bound}"
        )
        if table.relkind == "p":
            if not table.partition_key:
                raise RuntimeError(f"{table.schema}.{table.name} 缺少分区键定义")
            sql += f" PARTITION BY {table.partition_key}"
        return sql
    if table.relkind == "p":
        if not table.partition_key:
            raise RuntimeError(f"{table.schema}.{table.name} 缺少分区键定义")
        return (
            f"CREATE TABLE {_qualify(table.schema, table.name)} (\n    {joined}\n) "
            f"PARTITION BY {table.partition_key}"
        )
    return f"CREATE TABLE {_qualify(table.schema, table.name)} (\n    {joined}\n)"


def _sort_tables_for_creation(tables: list[TableDef]) -> list[TableDef]:
    table_map = {(table.schema, table.name): table for table in tables}
    ordered: list[TableDef] = []
    visiting: set[tuple[str, str]] = set()
    visited: set[tuple[str, str]] = set()

    def visit(table: TableDef) -> None:
        table_key = (table.schema, table.name)
        if table_key in visited:
            return
        if table_key in visiting:
            raise RuntimeError(f"检测到循环分区依赖: {table.schema}.{table.name}")

        visiting.add(table_key)
        if table.parent_schema and table.parent_name:
            parent = table_map.get((table.parent_schema, table.parent_name))
            if parent is not None:
                visit(parent)
        visiting.remove(table_key)
        visited.add(table_key)
        ordered.append(table)

    for table in sorted(tables, key=lambda item: (item.schema, item.name)):
        visit(table)
    return ordered


async def _drop_existing_objects(
    target: asyncpg.Connection,
    views: list[tuple[str, str, str]],
    tables: list[TableDef],
    sequences: list[SequenceDef],
    enums: list[EnumDef],
    composite_types: list[CompositeTypeDef],
    aggregates: list[AggregateDef],
    operator_classes: list[OperatorClassDef],
    operator_families: list[OperatorFamilyDef],
    operators: list[OperatorDef],
) -> None:
    for schema_name, view_name, _ in reversed(views):
        await target.execute(f"DROP VIEW IF EXISTS {_qualify(schema_name, view_name)} CASCADE")
    for aggregate in reversed(aggregates):
        await target.execute(
            f"DROP AGGREGATE IF EXISTS {_qualify(aggregate.schema, aggregate.name)}({aggregate.identity_args}) CASCADE"
        )
    for table in reversed(_sort_tables_for_creation(tables)):
        await target.execute(f"DROP TABLE IF EXISTS {_qualify(table.schema, table.name)} CASCADE")
    for operator_class in reversed(operator_classes):
        await target.execute(
            f"DROP OPERATOR CLASS IF EXISTS {_qualify(operator_class.schema, operator_class.name)} "
            f"USING {_quote_ident(operator_class.index_method)} CASCADE"
        )
    for operator_family in reversed(operator_families):
        await target.execute(
            f"DROP OPERATOR FAMILY IF EXISTS {_qualify(operator_family.schema, operator_family.name)} "
            f"USING {_quote_ident(operator_family.index_method)} CASCADE"
        )
    for operator in reversed(operators):
        await target.execute(
            f"DROP OPERATOR IF EXISTS {_qualify_operator(operator.schema, operator.name)}"
            f" ({_format_operator_operand(operator.left_type)}, {_format_operator_operand(operator.right_type)}) CASCADE"
        )
    for sequence in reversed(sequences):
        await target.execute(f"DROP SEQUENCE IF EXISTS {_qualify(sequence.schema, sequence.name)} CASCADE")
    for composite_type in reversed(composite_types):
        await target.execute(f"DROP TYPE IF EXISTS {_qualify(composite_type.schema, composite_type.name)} CASCADE")
    for enum in reversed(enums):
        await target.execute(f"DROP TYPE IF EXISTS {_qualify(enum.schema, enum.name)} CASCADE")


async def _ensure_schemas(target: asyncpg.Connection, schemas: list[str]) -> None:
    for schema_name in schemas:
        await target.execute(f"CREATE SCHEMA IF NOT EXISTS {_quote_ident(schema_name)}")


async def _ensure_extensions(
    target: asyncpg.Connection,
    extensions: list[tuple[str, str]],
    warnings: list[str],
) -> set[str]:
    failed_extensions: set[str] = set()
    target_extension_map = {ext_name: schema_name for ext_name, schema_name in await _fetch_extensions(target)}
    for ext_name, schema_name in extensions:
        try:
            current_schema = target_extension_map.get(ext_name)
            if current_schema is not None and current_schema != schema_name:
                await target.execute(f"DROP EXTENSION IF EXISTS {_quote_ident(ext_name)} CASCADE")
                target_extension_map.pop(ext_name, None)
                print(f"[extension] reset {ext_name} from schema {current_schema} to {schema_name}")
            if schema_name != "pg_catalog":
                await target.execute(f"CREATE SCHEMA IF NOT EXISTS {_quote_ident(schema_name)}")
                await target.execute(
                    f"CREATE EXTENSION IF NOT EXISTS {_quote_ident(ext_name)} WITH SCHEMA {_quote_ident(schema_name)}"
                )
            else:
                await target.execute(f"CREATE EXTENSION IF NOT EXISTS {_quote_ident(ext_name)}")
            target_extension_map = {
                installed_ext_name: installed_schema_name
                for installed_ext_name, installed_schema_name in await _fetch_extensions(target)
            }
            installed_schema = target_extension_map.get(ext_name)
            if installed_schema != schema_name:
                await target.execute(
                    f"ALTER EXTENSION {_quote_ident(ext_name)} SET SCHEMA {_quote_ident(schema_name)}"
                )
                target_extension_map = {
                    installed_ext_name: installed_schema_name
                    for installed_ext_name, installed_schema_name in await _fetch_extensions(target)
                }
                installed_schema = target_extension_map.get(ext_name)
            if installed_schema != schema_name:
                raise RuntimeError(
                    f"扩展 {ext_name} 实际安装在 {installed_schema or '未知 schema'}，无法对齐到 {schema_name}"
                )
            print(f"[extension] {ext_name} ok")
        except Exception as exc:
            warning = f"扩展 {ext_name} 无法安装，已跳过: {exc}"
            warnings.append(warning)
            failed_extensions.add(ext_name)
            print(f"[warn] {warning}")
    return failed_extensions


async def _drop_target_only_extensions(
    target: asyncpg.Connection,
    source_extensions: list[tuple[str, str]],
    warnings: list[str],
) -> None:
    target_extensions = await _fetch_extensions(target)
    source_extension_map = {ext_name: schema_name for ext_name, schema_name in source_extensions}
    extra_extensions = [
        (ext_name, schema_name)
        for ext_name, schema_name in target_extensions
        if source_extension_map.get(ext_name) != schema_name
    ]
    for ext_name, schema_name in reversed(sorted(extra_extensions)):
        try:
            await target.execute(f"DROP EXTENSION IF EXISTS {_quote_ident(ext_name)} CASCADE")
            print(f"[extension] dropped extra extension {ext_name} from {schema_name}")
        except Exception as exc:
            warning = f"扩展 {ext_name} 删除失败: {exc}"
            warnings.append(warning)
            print(f"[warn] {warning}")


async def _create_enums(target: asyncpg.Connection, enums: list[EnumDef]) -> None:
    for enum in enums:
        labels = ", ".join(_quote_literal(label) for label in enum.labels)
        await target.execute(f"CREATE TYPE {_qualify(enum.schema, enum.name)} AS ENUM ({labels})")


async def _create_composite_types(target: asyncpg.Connection, composite_types: list[CompositeTypeDef]) -> None:
    for composite_type in composite_types:
        field_sql = ", ".join(
            f"{_quote_ident(field.name)} {field.data_type}" for field in composite_type.fields
        )
        await target.execute(f"CREATE TYPE {_qualify(composite_type.schema, composite_type.name)} AS ({field_sql})")


async def _create_sequences(target: asyncpg.Connection, sequences: list[SequenceDef]) -> None:
    for sequence in sequences:
        clauses = [
            f"CREATE SEQUENCE {_qualify(sequence.schema, sequence.name)}",
            f"AS {sequence.data_type}",
            f"INCREMENT BY {sequence.increment_by}",
            f"START WITH {sequence.start_value}",
            f"CACHE {sequence.cache_size}",
        ]
        if sequence.min_value is None:
            clauses.append("NO MINVALUE")
        else:
            clauses.append(f"MINVALUE {sequence.min_value}")
        if sequence.max_value is None:
            clauses.append("NO MAXVALUE")
        else:
            clauses.append(f"MAXVALUE {sequence.max_value}")
        clauses.append("CYCLE" if sequence.cycle else "NO CYCLE")
        await target.execute(" ".join(clauses))


async def _create_tables(target: asyncpg.Connection, tables: list[TableDef]) -> None:
    for table in _sort_tables_for_creation(tables):
        await target.execute(_build_create_table_sql(table))


async def _copy_table_data(
    source: asyncpg.Connection,
    target: asyncpg.Connection,
    table: TableDef,
) -> int:
    if table.is_partition:
        print(f"[data] {table.schema}.{table.name}: skipped partition child")
        return 0

    column_names = [column.name for column in table.columns]
    select_sql = (
        "SELECT "
        + ", ".join(_quote_ident(column_name) for column_name in column_names)
        + f" FROM {_qualify(table.schema, table.name)}"
    )
    inserted = 0
    records: list[tuple[object, ...]] = []
    async with source.transaction():
        async for row in source.cursor(select_sql):
            records.append(tuple(row[column_name] for column_name in column_names))
            if len(records) >= DATA_BATCH_SIZE:
                await target.copy_records_to_table(
                    table.name,
                    schema_name=table.schema,
                    records=records,
                    columns=column_names,
                )
                inserted += len(records)
                records = []

    if records:
        await target.copy_records_to_table(
            table.name,
            schema_name=table.schema,
            records=records,
            columns=column_names,
        )
        inserted += len(records)

    print(f"[data] {table.schema}.{table.name}: {inserted} rows")
    return inserted


async def _create_constraints(
    target: asyncpg.Connection,
    constraints: list[tuple[str, str, str, str]],
    label: str,
    warnings: list[str],
) -> None:
    for schema_name, table_name, constraint_name, definition in constraints:
        sql = (
            f"ALTER TABLE {_qualify(schema_name, table_name)} "
            f"ADD CONSTRAINT {_quote_ident(constraint_name)} {definition}"
        )
        try:
            await target.execute(sql)
        except Exception as exc:
            warning = f"{label} 约束 {schema_name}.{table_name}.{constraint_name} 创建失败: {exc}"
            warnings.append(warning)
            print(f"[warn] {warning}")


async def _create_indexes(
    target: asyncpg.Connection,
    indexes: list[tuple[str, str, str]],
    warnings: list[str],
) -> None:
    for schema_name, table_name, ddl in indexes:
        try:
            await target.execute(ddl)
        except Exception as exc:
            warning = f"索引 {schema_name}.{table_name} 创建失败: {exc}"
            warnings.append(warning)
            print(f"[warn] {warning}")


async def _create_functions(
    target: asyncpg.Connection,
    functions: list[FunctionDef],
    warnings: list[str],
) -> None:
    for function in functions:
        try:
            await target.execute(function.ddl)
        except Exception as exc:
            warning = f"函数 {function.schema}.{function.name} 创建失败: {exc}"
            warnings.append(warning)
            print(f"[warn] {warning}")


async def _create_operators(
    target: asyncpg.Connection,
    operators: list[OperatorDef],
    warnings: list[str],
) -> None:
    for operator in operators:
        try:
            await target.execute(operator.ddl)
        except Exception as exc:
            warning = f"操作符 {operator.schema}.{operator.name} 创建失败: {exc}"
            warnings.append(warning)
            print(f"[warn] {warning}")


async def _create_operator_families(
    target: asyncpg.Connection,
    operator_families: list[OperatorFamilyDef],
    warnings: list[str],
) -> None:
    for operator_family in operator_families:
        try:
            await target.execute(operator_family.ddl)
        except Exception as exc:
            warning = f"操作符族 {operator_family.schema}.{operator_family.name} 创建失败: {exc}"
            warnings.append(warning)
            print(f"[warn] {warning}")


async def _create_operator_classes(
    target: asyncpg.Connection,
    operator_classes: list[OperatorClassDef],
    warnings: list[str],
) -> None:
    for operator_class in operator_classes:
        try:
            await target.execute(operator_class.ddl)
        except Exception as exc:
            warning = f"操作符类 {operator_class.schema}.{operator_class.name} 创建失败: {exc}"
            warnings.append(warning)
            print(f"[warn] {warning}")


async def _create_operator_family_members(
    target: asyncpg.Connection,
    operator_family_members: list[OperatorFamilyMemberDef],
    warnings: list[str],
) -> None:
    for member in operator_family_members:
        try:
            await target.execute(member.ddl)
        except Exception as exc:
            warning = f"操作符族成员 {member.family_schema}.{member.family_name} 创建失败: {exc}"
            warnings.append(warning)
            print(f"[warn] {warning}")


async def _create_aggregates(
    target: asyncpg.Connection,
    aggregates: list[AggregateDef],
    warnings: list[str],
) -> None:
    for aggregate in aggregates:
        try:
            await target.execute(aggregate.ddl)
        except Exception as exc:
            warning = f"聚合 {aggregate.schema}.{aggregate.name} 创建失败: {exc}"
            warnings.append(warning)
            print(f"[warn] {warning}")


async def _create_views(
    target: asyncpg.Connection,
    views: list[tuple[str, str, str]],
    warnings: list[str],
) -> None:
    for schema_name, view_name, definition in views:
        sql = f"CREATE OR REPLACE VIEW {_qualify(schema_name, view_name)} AS {definition}"
        try:
            await target.execute(sql)
        except Exception as exc:
            warning = f"视图 {schema_name}.{view_name} 创建失败: {exc}"
            warnings.append(warning)
            print(f"[warn] {warning}")


async def _create_triggers(
    target: asyncpg.Connection,
    triggers: list[tuple[str, str, str]],
    warnings: list[str],
) -> None:
    for schema_name, table_name, ddl in triggers:
        try:
            await target.execute(ddl)
        except Exception as exc:
            warning = f"触发器 {schema_name}.{table_name} 创建失败: {exc}"
            warnings.append(warning)
            print(f"[warn] {warning}")


async def _sync_sequence_values(
    source: asyncpg.Connection,
    target: asyncpg.Connection,
    sequences: list[SequenceDef],
    warnings: list[str],
) -> None:
    for sequence in sequences:
        qualified = _qualify(sequence.schema, sequence.name)
        try:
            row = await source.fetchrow(f"SELECT last_value, is_called FROM {qualified}")
            await target.execute(
                f"SELECT setval({_quote_literal(f'{sequence.schema}.{sequence.name}')}, $1, $2)",
                row["last_value"],
                row["is_called"],
            )
        except Exception as exc:
            warning = f"序列 {sequence.schema}.{sequence.name} 同步失败: {exc}"
            warnings.append(warning)
            print(f"[warn] {warning}")


async def _fetch_row_counts(conn: asyncpg.Connection, tables: list[TableDef]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for table in tables:
        count = await conn.fetchval(f"SELECT COUNT(*) FROM {_qualify(table.schema, table.name)}")
        counts[f"{table.schema}.{table.name}"] = count
    return counts


async def _drop_target_only_objects(
    target: asyncpg.Connection,
    source_schemas: list[str],
    source_views: list[tuple[str, str, str]],
    source_tables: list[TableDef],
    source_sequences: list[SequenceDef],
    source_enums: list[EnumDef],
    source_composite_types: list[CompositeTypeDef],
    source_functions: list[FunctionDef],
    source_aggregates: list[AggregateDef],
    source_operator_classes: list[OperatorClassDef],
    source_operator_families: list[OperatorFamilyDef],
    source_operator_family_members: list[OperatorFamilyMemberDef],
    source_operators: list[OperatorDef],
) -> None:
    target_schemas = await _fetch_user_schemas(target)
    target_views = await _fetch_views(target)
    target_tables = await _fetch_tables(target)
    target_sequences = await _fetch_sequences(target)
    target_enums = await _fetch_enums(target)
    target_composite_types = await _fetch_composite_types(target)
    target_functions = await _fetch_functions(target)
    target_aggregates = await _fetch_aggregates(target)
    target_operator_classes = await _fetch_operator_classes(target)
    target_operator_families = await _fetch_operator_families(target)
    target_operator_family_members = await _fetch_operator_family_members(target)
    target_operators = await _fetch_operators(target)

    source_view_keys = {(schema_name, view_name) for schema_name, view_name, _ in source_views}
    source_table_keys = {(table.schema, table.name) for table in source_tables}
    source_sequence_keys = {(sequence.schema, sequence.name) for sequence in source_sequences}
    source_enum_keys = {(enum.schema, enum.name) for enum in source_enums}
    source_composite_type_keys = {(item.schema, item.name) for item in source_composite_types}
    source_function_keys = {
        (function.schema, function.name, function.prokind, function.identity_args) for function in source_functions
    }
    source_aggregate_keys = {
        (aggregate.schema, aggregate.name, aggregate.identity_args) for aggregate in source_aggregates
    }
    source_operator_class_keys = {
        (operator_class.schema, operator_class.name, operator_class.index_method, operator_class.input_type)
        for operator_class in source_operator_classes
    }
    source_operator_family_keys = {
        (operator_family.schema, operator_family.name, operator_family.index_method)
        for operator_family in source_operator_families
    }
    source_operator_family_member_keys = {
        (
            member.family_schema,
            member.family_name,
            member.index_method,
            member.sort_key,
        )
        for member in source_operator_family_members
    }
    source_operator_keys = {
        (operator.schema, operator.name, operator.left_type, operator.right_type) for operator in source_operators
    }

    for aggregate in target_aggregates:
        aggregate_key = (aggregate.schema, aggregate.name, aggregate.identity_args)
        if aggregate_key not in source_aggregate_keys:
            await target.execute(
                f"DROP AGGREGATE IF EXISTS {_qualify(aggregate.schema, aggregate.name)}({aggregate.identity_args}) CASCADE"
            )

    for operator in target_operators:
        operator_key = (operator.schema, operator.name, operator.left_type, operator.right_type)
        if operator_key not in source_operator_keys:
            await target.execute(
                f"DROP OPERATOR IF EXISTS {_qualify_operator(operator.schema, operator.name)}"
                f" ({_format_operator_operand(operator.left_type)}, {_format_operator_operand(operator.right_type)}) CASCADE"
            )

    for function in target_functions:
        function_key = (function.schema, function.name, function.prokind, function.identity_args)
        if function_key not in source_function_keys:
            object_type = "PROCEDURE" if function.prokind == "p" else "AGGREGATE" if function.prokind == "a" else "FUNCTION"
            await target.execute(
                f"DROP {object_type} IF EXISTS {_qualify(function.schema, function.name)}({function.identity_args}) CASCADE"
            )

    for schema_name, view_name, _ in target_views:
        if (schema_name, view_name) not in source_view_keys:
            await target.execute(f"DROP VIEW IF EXISTS {_qualify(schema_name, view_name)} CASCADE")

    extra_tables = [table for table in target_tables if (table.schema, table.name) not in source_table_keys]
    for table in reversed(_sort_tables_for_creation(extra_tables)):
        await target.execute(f"DROP TABLE IF EXISTS {_qualify(table.schema, table.name)} CASCADE")

    for operator_class in reversed(target_operator_classes):
        operator_class_key = (
            operator_class.schema,
            operator_class.name,
            operator_class.index_method,
            operator_class.input_type,
        )
        if operator_class_key not in source_operator_class_keys:
            await target.execute(
                f"DROP OPERATOR CLASS IF EXISTS {_qualify(operator_class.schema, operator_class.name)} "
                f"USING {_quote_ident(operator_class.index_method)} CASCADE"
            )

    for member in reversed(target_operator_family_members):
        member_key = (
            member.family_schema,
            member.family_name,
            member.index_method,
            member.sort_key,
        )
        if member_key not in source_operator_family_member_keys:
            await target.execute(member.drop_ddl)

    for operator_family in reversed(target_operator_families):
        operator_family_key = (
            operator_family.schema,
            operator_family.name,
            operator_family.index_method,
        )
        if operator_family_key not in source_operator_family_keys:
            await target.execute(
                f"DROP OPERATOR FAMILY IF EXISTS {_qualify(operator_family.schema, operator_family.name)} "
                f"USING {_quote_ident(operator_family.index_method)} CASCADE"
            )

    for sequence in reversed(target_sequences):
        if (sequence.schema, sequence.name) not in source_sequence_keys:
            await target.execute(f"DROP SEQUENCE IF EXISTS {_qualify(sequence.schema, sequence.name)} CASCADE")

    for composite_type in reversed(target_composite_types):
        if (composite_type.schema, composite_type.name) not in source_composite_type_keys:
            await target.execute(f"DROP TYPE IF EXISTS {_qualify(composite_type.schema, composite_type.name)} CASCADE")

    for enum in reversed(target_enums):
        if (enum.schema, enum.name) not in source_enum_keys:
            await target.execute(f"DROP TYPE IF EXISTS {_qualify(enum.schema, enum.name)} CASCADE")

    source_schema_keys = set(source_schemas)
    for schema_name in reversed(sorted(target_schemas)):
        if schema_name not in source_schema_keys:
            await target.execute(f"DROP SCHEMA IF EXISTS {_quote_ident(schema_name)} CASCADE")


async def migrate() -> None:
    _load_env_file()
    source_dsn = _get_required_env(ENV_SOURCE_DATABASE_URL)
    target_dsn = _get_required_env(ENV_TARGET_DATABASE_URL)

    source = await _connect("source", source_dsn)
    target = await _connect("target", target_dsn)
    warnings: list[str] = []

    try:
        schemas = await _fetch_source_schemas(source)
        extensions = await _fetch_extensions(source)
        enums = await _fetch_enums(source)
        sequences = await _fetch_sequences(source)
        composite_types = await _fetch_composite_types(source)
        tables = await _fetch_tables(source)
        regular_constraints, foreign_keys = await _fetch_constraints(source)
        indexes = await _fetch_indexes(source)
        functions = await _fetch_functions(source)
        aggregates = await _fetch_aggregates(source)
        operator_families = await _fetch_operator_families(source)
        operator_classes = await _fetch_operator_classes(source)
        operator_family_members = await _fetch_operator_family_members(source)
        operators = await _fetch_operators(source)
        views = await _fetch_views(source)
        triggers = await _fetch_triggers(source)

        print(f"待迁移 schema: {', '.join(schemas)}")
        print(f"待迁移表数量: {len(tables)}")

        await _ensure_schemas(target, schemas)
        await _drop_target_only_extensions(target, extensions, warnings)
        failed_extensions = await _ensure_extensions(target, extensions, warnings)
        if failed_extensions:
            failed_text = ", ".join(sorted(failed_extensions))
            warning = f"以下扩展无法安装，扩展自带对象将被跳过: {failed_text}"
            warnings.append(warning)
            print(f"[warn] {warning}")

        await _drop_target_only_objects(
            target,
            schemas,
            views,
            tables,
            sequences,
            enums,
            composite_types,
            functions,
            aggregates,
            operator_classes,
            operator_families,
            operator_family_members,
            operators,
        )
        await _drop_existing_objects(
            target,
            views,
            tables,
            sequences,
            enums,
            composite_types,
            aggregates,
            operator_classes,
            operator_families,
            operators,
        )
        await _create_enums(target, enums)
        await _create_composite_types(target, composite_types)
        await _create_sequences(target, sequences)
        await _create_functions(target, functions, warnings)
        await _create_tables(target, tables)

        inserted_total = 0
        for table in tables:
            inserted_total += await _copy_table_data(source, target, table)

        await _create_functions(target, functions, warnings)
        await _create_operators(target, operators, warnings)
        await _create_operator_families(target, operator_families, warnings)
        await _create_operator_classes(target, operator_classes, warnings)
        await _create_operator_family_members(target, operator_family_members, warnings)
        await _create_constraints(target, regular_constraints, "普通", warnings)
        await _create_constraints(target, foreign_keys, "外键", warnings)
        await _create_indexes(target, indexes, warnings)
        await _create_aggregates(target, aggregates, warnings)
        await _create_views(target, views, warnings)
        await _create_triggers(target, triggers, warnings)
        await _sync_sequence_values(source, target, sequences, warnings)

        print(f"总计迁移行数: {inserted_total}")
        try:
            source_counts = await _fetch_row_counts(source, tables)
            target_counts = await _fetch_row_counts(target, tables)
            mismatches = [
                (table_name, source_counts[table_name], target_counts.get(table_name))
                for table_name in source_counts
                if source_counts[table_name] != target_counts.get(table_name)
            ]
            if mismatches:
                print("以下表计数不一致：")
                for table_name, src_count, dst_count in mismatches:
                    print(f"  - {table_name}: source={src_count}, target={dst_count}")
            else:
                print("所有表的行数校验一致。")
        except Exception as exc:
            warning = f"最终行数校验未完成，但迁移主体已执行完成: {exc}"
            warnings.append(warning)
            print(f"[warn] {warning}")

        if warnings:
            print("\n迁移告警：")
            for warning in warnings:
                print(f"- {warning}")
    finally:
        await source.close()
        await target.close()


if __name__ == "__main__":
    asyncio.run(migrate())
