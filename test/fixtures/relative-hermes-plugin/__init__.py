from .helper import echo


SCHEMA = {
    "name": "relative_echo",
    "description": "Echo via relative import.",
    "parameters": {
        "type": "object",
        "properties": {"value": {"type": "string"}},
        "required": ["value"],
    },
}


def _handler(args):
    return echo(args.get("value", ""))


def register(ctx):
    ctx.register_tool(
        name="relative_echo",
        toolset="relative",
        schema=SCHEMA,
        handler=_handler,
    )
