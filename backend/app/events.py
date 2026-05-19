"""In-process SSE event registry — per-user asyncio queues for real-time browser push."""
import asyncio
import json
from collections import defaultdict
from typing import Any

_connections: dict[int, list[asyncio.Queue]] = defaultdict(list)


def subscribe(user_id: int) -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue(maxsize=64)
    _connections[user_id].append(q)
    return q


def unsubscribe(user_id: int, queue: asyncio.Queue) -> None:
    try:
        _connections[user_id].remove(queue)
    except ValueError:
        pass
    if user_id in _connections and not _connections[user_id]:
        del _connections[user_id]


async def broadcast(user_id: int, event: str, data: Any) -> None:
    payload = f"event: {event}\ndata: {json.dumps(data)}\n\n"
    for q in list(_connections.get(user_id, [])):
        try:
            q.put_nowait(payload)
        except asyncio.QueueFull:
            pass
