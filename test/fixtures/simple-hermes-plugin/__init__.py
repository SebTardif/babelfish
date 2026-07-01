import json
import os
from pathlib import Path

print("fixture import")
STATE = {"value": "unset"}


ECHO_SCHEMA = {
    "name": "simple_echo",
    "description": "Echo a value.",
    "parameters": {
        "type": "object",
        "properties": {"value": {"type": "string"}},
        "required": ["value"],
    },
}


def _echo(args):
    print("fixture tool")
    if set(args) != {"value"}:
        return json.dumps({"unexpected": sorted(args)})
    return json.dumps({"echo": args.get("value", "")})


def _state(args):
    return {"state": STATE["value"]}


def _optional(args=None):
    return {"optional": args}


def _hook(**kwargs):
    return None


def _no_arg_hook():
    return "no-arg"


def _failing_hook(**kwargs):
    raise RuntimeError("fixture hook failure")


def _pre_tool(**kwargs):
    if kwargs.get("tool_name") == "blocked":
        return {"action": "block", "message": "blocked"}
    return None


def _transform(**kwargs):
    if kwargs.get("tool_name") == "simple_echo":
        return "transformed"
    return None


def _context(**kwargs):
    return {"context": "fixture context"}


def _llm_request(request, **kwargs):
    return {
        "request": {
            **request,
            "prepend_context": "middleware context",
            "appendSystemContext": "middleware system context",
        }
    }


def _record_api_hook(name):
    def record(**kwargs):
        target = os.environ.get("BABELFISH_TEST_HOOK_LOG")
        if target:
            with open(target, "a", encoding="utf-8") as handle:
                handle.write(f"{name}\n")

    return record


def _set_state(**kwargs):
    STATE["value"] = kwargs.get("value", "set")


def _setup_cli(parser):
    parser.add_argument("value")


def _cli_command(args):
    print(f"printed:{args.value}")
    return {"cli": args.value}


def register(ctx):
    print("fixture register")
    ctx.register_tool(
        name="simple_echo",
        toolset="simple",
        schema=ECHO_SCHEMA,
        handler=_echo,
    )
    ctx.register_tool(
        name="simple_state",
        toolset="simple",
        schema={"name": "simple_state", "description": "Read state", "parameters": {"type": "object"}},
        handler=_state,
    )
    ctx.register_tool(
        name="simple_optional",
        toolset="simple",
        schema={"type": "function", "function": {"parameters": {"type": "object", "required": ["value"], "properties": {"value": {"type": "string"}}}}},
        handler=_optional,
    )
    ctx.register_hook("post_tool_call", _failing_hook)
    ctx.register_hook("post_tool_call", _hook)
    ctx.register_hook("post_tool_call", _no_arg_hook)
    ctx.register_hook("pre_tool_call", _pre_tool)
    ctx.register_hook("transform_tool_result", _transform)
    ctx.register_hook("pre_llm_call", _context)
    ctx.register_hook("post_api_request", _record_api_hook("post_api_request"))
    ctx.register_hook("api_request_error", _record_api_hook("api_request_error"))
    ctx.register_hook("on_session_start", _set_state)
    ctx.register_middleware("llm_request", _llm_request)
    ctx.register_command("simple", lambda raw: {"command": raw}, "Simple command", "<raw text>")
    ctx.register_cli_command(
        "simplecli",
        "Simple CLI command",
        _setup_cli,
        _cli_command,
        "Simple CLI command",
    )
    ctx.register_skill("simple_skill", Path("skills/simple.md"), "Simple skill fixture")
