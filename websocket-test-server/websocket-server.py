#!/usr/bin/env python3
"""
WebSocket relay server for Swimnerd scoreboard overlays.
Broadcasts messages from the Simulator to all connected OBS overlay sources.

Usage: python3 websocket-server.py
"""

import asyncio
import websockets

PORT = 8080
clients = set()

async def handler(websocket):
    clients.add(websocket)
    print(f"Client connected. Total clients: {len(clients)}")

    try:
        async for message in websocket:
            print(f"Broadcasting message to {len(clients)} clients")
            # Broadcast to all connected clients
            websockets.broadcast(clients, message)
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        clients.discard(websocket)
        print(f"Client disconnected. Total clients: {len(clients)}")

async def main():
    print(f"WebSocket server running on ws://localhost:{PORT}")
    print("Waiting for connections from Simulator and OBS overlays...")

    async with websockets.serve(handler, "localhost", PORT):
        await asyncio.Future()  # Run forever

if __name__ == "__main__":
    asyncio.run(main())
