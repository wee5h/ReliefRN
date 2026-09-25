// Browser-layout QA adapter for a Node-only preview environment.
// Production and normal offline runs both use the real Python server in app.py.
import {defineConfig} from 'vite';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const chats = new Map();
let number = 0;
const offer = 'I can prepare a brief for human follow-up. Forwarding and callbacks are simulated in this demo. Would you like me to prepare your callback report?';
function fresh() {
  return {messages: [{role: 'assistant', content: "Hi, I'm ReliefRN. I'm an automated disaster assistance agent. I can help you find shelter, disaster aid, and local services. I support most languages. What do you need help with?"}], reports: [], started_at: new Date().toISOString(), callback_pending: false, report_status: 'none', test_mode: true};
}
export default defineConfig({
  server: {host: '0.0.0.0', allowedHosts: ['terminal.local']},
  plugins: [{name: 'offline-layout-qa', configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (req.url === '/') {
        res.setHeader('Content-Type', 'text/html');
        return res.end(readFileSync(new URL('./static/index.html', import.meta.url)));
      }
      if (!req.url.startsWith('/api/')) return next();
      let id = req.headers.cookie?.match(/qa_session=([a-f0-9-]+)/)?.[1];
      if (!id || !chats.has(id)) {id = randomUUID(); chats.set(id, fresh());}
      res.setHeader('Set-Cookie', `qa_session=${id}; Path=/; HttpOnly; SameSite=Strict`);
      res.setHeader('Content-Type', 'application/json');
      if (req.url.startsWith('/api/reports/')) {
        res.setHeader('Content-Type', 'text/markdown');
        res.setHeader('Content-Disposition', 'attachment; filename="offline-preview-report.md"');
        return res.end('# OFFLINE PREVIEW\n\nThis is a layout test, not an agent-generated report.');
      }
      let data = '';
      for await (const chunk of req) data += chunk;
      let body;
      try {body = data ? JSON.parse(data) : {};} catch {res.statusCode = 400; return res.end('{}');}
      if (req.url === '/api/session' && body.new) chats.set(id, fresh());
      const chat = chats.get(id);
      if (req.url === '/api/message') {
        if (chat.seen === body.request_id) return res.end(JSON.stringify(chat));
        chat.seen = body.request_id;
        chat.messages.push({role: 'user', content: body.text});
        if (body.action === 'confirm_callback' || (chat.callback_pending && /^yes(?:[,.! ]|$)/i.test(body.text))) {
          chat.callback_pending = false;
          chat.report_status = 'saved';
          const n = ++number, name = `reliefrn-report-${String(n).padStart(4, '0')}.md`;
          chat.reports.push({number:n, filename:name, url:`/api/reports/${name}`});
          chat.messages.push({role:'assistant', content:`Your callback report #${String(n).padStart(4, '0')} has been created and saved. Forwarding and callbacks are simulated in this demo; nothing has been sent to FEMA.`});
        } else if (body.action === 'decline_callback') {
          chat.callback_pending = false;
          chat.messages.push({role:'assistant', content:'No report will be prepared. What else can I help you with?'});
        } else if (/callback|call me|human|report/i.test(body.text)) {
          chat.callback_pending = true;
          chat.messages.push({role:'assistant', content:offer});
        } else {
          chat.callback_pending = false;
          chat.messages.push({role:'assistant', content:'This is the offline preview. In the live app, ReliefRN uses your saved Assistance-agent to respond. You can ask for a callback to try the report flow.'});
        }
      }
      res.end(JSON.stringify(chat));
    });
  }}],
});
