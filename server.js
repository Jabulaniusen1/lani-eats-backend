const http = require('http');
const app = require('./src/app');
const { initializeSocket } = require('./src/config/socket');

const PORT = process.env.PORT || 5000;

const server = http.createServer(app);

initializeSocket(server);

server.listen(PORT, () => {
    console.log(`Lanieats server running on port ${PORT}`);
});