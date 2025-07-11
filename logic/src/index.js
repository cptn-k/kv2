const express = require('express');
const bodyParser = require('body-parser');
const { send } = require('./handler/chat-handler');
const dummy = require('./handler/dummy');
const google = require('./handler/google-handler');
const slack = require('./handler/slack-handler');
const backdoor = require('./handler/backdoor/index');
const clickup = require('./handler/clickup-handler');
const imageHandler = require('./handler/image-handler');
const systemHandler = require('./handler/system-handler');
const https = require('https');
const fs = require('fs');


const PORT = process.env.PORT || 8080;


function printGreetings(mode) {
  const msg = `
    ╔══════════════════════════════════════════╗
    ║            Server Started                ║
    ╚══════════════════════════════════════════╝

    📡 Mode: ${mode} Server
    🌐 Port: ${PORT}
    ⏰ Time: ${new Date().toLocaleString()}
    🔧 Environment: ${process.env.NODE_ENV || 'development'}

    ────────────────────────────────────────────`;

  console.log(msg.replace(/^[ \t]+/gm, ''));
}


const app = express();
app.use(bodyParser.json());

app.post('/slack/webhook', slack.handleEvent);
app.get('/slack/auth', slack.authStart);
app.get('/slack/auth/callback', slack.handleAuthCallback);

app.get('/google/auth', google.startAuth);
app.get('/google/auth/callback', google.handleAuthCallback);

app.get('/clickup/auth/callback', clickup.handleAuthCallback);

app.post('/image', express.raw({
  type: ['image/png', 'image/jpeg'],
  limit: '10mb'
}), imageHandler.uploadImage);

app.get('/image/:key', imageHandler.getImage);

// System endpoints
app.get('/system/refresh', systemHandler.refreshCache);

app.post('/chat', send);
app.get('/echo', dummy);

backdoor.setupBackdoorRoutes(app);

// TODO: Create backdoor key

if (process.env.DEPLOYMENT === 'local') {
  const options = {
    key: fs.readFileSync("localhost-key.pem"),
    cert: fs.readFileSync("localhost.pem")
  };
  https.createServer(options, app).listen(PORT, () => {
    printGreetings("HTTPS");
  });
} else {
  app.listen(PORT, () => {
    printGreetings("HTTP");
  });
}
