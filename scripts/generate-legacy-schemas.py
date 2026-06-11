#!/usr/bin/env python3
"""
Generates the registry JSON schemas + UI schemas exactly as the legacy
registry-api served them, by importing the legacy pydantic models and the
legacy schema override config.

Output: packages/interfaces/src/generated/registrySchemas.json

Usage:
    /tmp/legacy-venv/bin/python scripts/generate-legacy-schemas.py

Requires a python env with: pydantic<2, email-validator, isodate
"""
import json
import sys
import types
import warnings
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
LEGACY = REPO_ROOT / "provena"

sys.path.insert(0, str(LEGACY / "utilities/packages/python/provena-interfaces"))
sys.path.insert(0, str(LEGACY / "registry-api"))

# Stub the route_models import used (typing only) by registry-api/schemas.py
route_models_stub = types.ModuleType("route_models")
route_models_stub.ItemModelTypeVar = object  # type: ignore
sys.modules["route_models"] = route_models_stub

import pydantic  # noqa: E402
from pydantic.fields import ModelField  # noqa: E402

# ---------------------------------------------------------------------------
# Apply the same pydantic Optional-null patch the legacy registry main.py used
# (so served schemas match byte-for-byte).
# ---------------------------------------------------------------------------
pydantic_field_type_schema = pydantic.schema.field_type_schema


def patch_pydantic_field_type_schema() -> None:
    def field_type_schema(field: ModelField, **kwargs):  # type: ignore
        null_type_schema = {"type": "null", "title": "None"}
        f_schema, definitions, nested_models = pydantic_field_type_schema(field, **kwargs)
        if field.allow_none:
            s_type = f_schema.get("type")
            if s_type:
                if kwargs.get("ref_prefix") == "#/components/schemas/":
                    f_schema = {"anyOf": [f_schema, null_type_schema]}
                else:
                    if not isinstance(s_type, list):
                        f_schema["type"] = [s_type]
                    f_schema["type"].append("null")
            elif "$ref" in f_schema:
                f_schema["anyOf"] = [{**f_schema}, null_type_schema]
                del f_schema["$ref"]
            elif "allOf" in f_schema:
                f_schema["anyOf"] = f_schema["allOf"]
                del f_schema["allOf"]
                f_schema["anyOf"].append(null_type_schema)
            elif "anyOf" in f_schema or "oneOf" in f_schema:
                one_or_any = f_schema.get("anyOf") or f_schema.get("oneOf")
                for item in one_or_any:  # type: ignore
                    if item.get("type") == "null":
                        break
                else:
                    one_or_any.append(null_type_schema)  # type: ignore
        return f_schema, definitions, nested_models

    pydantic.schema.field_type_schema = field_type_schema


patch_pydantic_field_type_schema()

warnings.filterwarnings("ignore")

from ProvenaInterfaces.RegistryModels import (  # noqa: E402
    CreateDomainInfo,
    DatasetDomainInfo,
    DatasetTemplateDomainInfo,
    ItemCreate,
    ItemDataset,
    ItemDatasetTemplate,
    ItemModel,
    ItemModelRun,
    ItemModelRunWorkflowTemplate,
    ItemOrganisation,
    ItemPerson,
    ItemStudy,
    ItemVersion,
    ModelDomainInfo,
    ModelRunDomainInfo,
    ModelRunWorkflowTemplateDomainInfo,
    OrganisationDomainInfo,
    PersonDomainInfo,
    StudyDomainInfo,
    VersionDomainInfo,
)

import schemas as legacy_schemas  # noqa: E402  (registry-api/schemas.py)

SUBTYPE_CONFIG = {
    "ORGANISATION": (OrganisationDomainInfo, ItemOrganisation),
    "PERSON": (PersonDomainInfo, ItemPerson),
    "MODEL": (ModelDomainInfo, ItemModel),
    "MODEL_RUN_WORKFLOW_TEMPLATE": (
        ModelRunWorkflowTemplateDomainInfo,
        ItemModelRunWorkflowTemplate,
    ),
    "DATASET_TEMPLATE": (DatasetTemplateDomainInfo, ItemDatasetTemplate),
    "DATASET": (DatasetDomainInfo, ItemDataset),
    "STUDY": (StudyDomainInfo, ItemStudy),
    "CREATE": (CreateDomainInfo, ItemCreate),
    "VERSION": (VersionDomainInfo, ItemVersion),
    "MODEL_RUN": (ModelRunDomainInfo, ItemModelRun),
}

output = {}
for subtype, (domain_info_type, item_type) in SUBTYPE_CONFIG.items():
    json_schema_override = legacy_schemas.JSON_SCHEMA_OVERRIDES.get(item_type)
    output[subtype] = {
        "json_schema": json_schema_override
        if json_schema_override is not None
        else domain_info_type.schema(),
        "ui_schema": legacy_schemas.UI_SCHEMA_OVERRIDES.get(item_type) or {},
    }

# Dataset collection format schema (served by data-store /metadata/dataset-schema)
from ProvenaInterfaces.RegistryModels import CollectionFormat  # noqa: E402

output["__COLLECTION_FORMAT__"] = {
    "json_schema": CollectionFormat.schema(),
    "ui_schema": {},
}

out_path = REPO_ROOT / "packages/interfaces/src/generated/registrySchemas.json"
out_path.parent.mkdir(parents=True, exist_ok=True)
out_path.write_text(json.dumps(output, indent=2) + "\n")
print(f"Wrote {out_path} ({len(output)} entries)")
