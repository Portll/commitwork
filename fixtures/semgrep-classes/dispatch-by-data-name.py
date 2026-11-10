# Annotated fixture for manifests/semgrep-classes/dispatch-by-data-name.yaml (Python rule).
ALLOWED_OPS = {"add", "mul", "concat"}


def apply_op(builder, record, inputs):
    # ruleid: cw-dispatch-by-data-name-py
    return getattr(builder, record.op_type)(**inputs)


def apply_op_checked_in_loop(builder, op_type, inputs):
    for name in inputs:
        if op_type not in ALLOWED_OPS:
            raise ValueError(op_type)
    # ruleid: cw-dispatch-by-data-name-py
    return getattr(builder, op_type)(**inputs)


def apply_op_checked(builder, op_type, inputs):
    if op_type not in ALLOWED_OPS:
        raise ValueError(op_type)
    # ok: cw-dispatch-by-data-name-py
    return getattr(builder, op_type)(**inputs)


def visit(visitor, node):
    # ok: cw-dispatch-by-data-name-py
    return getattr(visitor, f"visit_{node.kind}")(node)


def fixed(builder, inputs):
    # ok: cw-dispatch-by-data-name-py
    return getattr(builder, "update_state")(**inputs)
