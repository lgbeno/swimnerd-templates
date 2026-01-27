const WebSocket = require('ws');

const PORT = 8080;
const wss = new WebSocket.Server({ port: PORT });

const clients = new Set();

wss.on('connection', (ws) => {
    clients.add(ws);
    console.log(`Client connected. Total clients: ${clients.size}`);

    ws.on('message', (message) => {
        // Broadcast to all connected clients
        const messageStr = message.toString();
        console.log(`Broadcasting message to ${clients.size} clients`);

        clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(messageStr);
            }
        });
    });

    ws.on('close', () => {
        clients.delete(ws);
        console.log(`Client disconnected. Total clients: ${clients.size}`);
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
        clients.delete(ws);
    });
});

console.log(`WebSocket server running on ws://localhost:${PORT}`);
console.log('Waiting for connections from Simulator and OBS overlays...');
