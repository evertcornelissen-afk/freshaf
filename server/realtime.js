// Server-sent events hub: userId -> Set of open responses.
const clients = new Map();

function addClient(userId, res) {
  if (!clients.has(userId)) clients.set(userId, new Set());
  clients.get(userId).add(res);
  res.on('close', () => {
    const set = clients.get(userId);
    if (set) {
      set.delete(res);
      if (!set.size) clients.delete(userId);
    }
  });
}

function send(userId, event, data) {
  const set = clients.get(userId);
  if (!set) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) {
    try { res.write(payload); } catch { /* client gone; close handler cleans up */ }
  }
}

function sseHandler(req, res) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.flushHeaders();
  res.write('event: connected\ndata: {}\n\n');
  addClient(req.user.id, res);
  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { clearInterval(ping); }
  }, 25000);
  res.on('close', () => clearInterval(ping));
}

module.exports = { send, sseHandler };
