# workflows/__init__.py
"""Workflow blueprint registry.

Import ``get_workflow`` to obtain the currently active workflow builder
without coupling callers to a concrete class.
"""

from __future__ import annotations

from typing import Dict, Type

from workflows.workflow_blueprint import WorkflowBlueprint
from workflows.workflow import AnimaWorkflow

_REGISTRY: Dict[str, Type[WorkflowBlueprint]] = {
    "anima": AnimaWorkflow,
}


def get_workflow(name: str | None = None) -> WorkflowBlueprint:
    """Instantiate a workflow blueprint by registry key.

    Falls back to ``config.ACTIVE_WORKFLOW`` when *name* is ``None``.
    """
    import config

    key = (name or config.ACTIVE_WORKFLOW).lower()
    cls = _REGISTRY.get(key)
    if cls is None:
        raise ValueError(
            f"Unknown workflow '{key}'. Available: {list(_REGISTRY.keys())}"
        )
    return cls()
