"""Exercise the installed parent compositor, never synthetic scale metadata."""
import asyncio
import json
import subprocess
import websockets


def layout():
    output = subprocess.run(
        ["qdbus6", "org.kde.KWin", "/KWin", "org.kde.KWin.supportInformation"],
        capture_output=True, text=True, timeout=5, check=True,
    ).stdout
    return [line.strip() for line in output.splitlines()
            if line.startswith(("Geometry:", "Scale:", "Compositing Type:"))]


async def wait_scale(expected):
    for _ in range(50):
        measured = layout()
        if f"Scale: {expected}" in measured:
            print("LAYOUT: " + "; ".join(measured), flush=True)
            return
        await asyncio.sleep(0.1)
    raise AssertionError(f"actual KWin scale did not become {expected}: {measured}")


async def main():
    async with websockets.connect("ws://127.0.0.1:8082", max_size=8388608) as ws:
        async def drain():
            async for _ in ws:
                pass
        reader = asyncio.create_task(drain())
        settings = {"displayId": "primary", "encoder": "jpeg", "framerate": 5,
                    "initialClientWidth": 1024, "initialClientHeight": 768,
                    "is_manual_resolution_mode": True, "manual_width": 1024,
                    "manual_height": 768, "scaling_dpi": 96}
        try:
            await ws.send("SETTINGS," + json.dumps(settings))
            await asyncio.sleep(3)
            await wait_scale("1")
            await ws.send("s,144")
            await wait_scale("1.5")
            process = await asyncio.create_subprocess_exec(
                "/usr/local/bin/node", "/opt/mastra-cc/capture-client.mjs", "scale-refusal")
            assert await asyncio.wait_for(process.wait(), 15) == 0
        finally:
            await ws.send("s,96")
            await wait_scale("1")
            reader.cancel()
            print("RESTORED: actual compositor scale 1", flush=True)

asyncio.run(main())
