const $ = (id) => document.getElementById(id);
let busy = false;
let state = null;
let failedRequest = null;
const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

function updateClock() {
  $('clock').textContent = new Date().toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit'}).replace(/\s*[AP]M$/, '');
}
updateClock();
setInterval(updateClock, 30000);

async function api(path, body) {
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? {'Content-Type': 'application/json'} : {},
    credentials: 'same-origin',
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
}

// Render all text as text nodes. Agent messages never become HTML.
function messageContent(element, value) {
  const text = value.replace(/\*\*([^*\n]+)\*\*/g, '$1');
  const pattern = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>]+)/g;
  let end = 0;
  for (const match of text.matchAll(pattern)) {
    element.append(document.createTextNode(text.slice(end, match.index)));
    const link = document.createElement('a');
    link.href = match[2] || match[3];
    link.textContent = match[1] || match[3];
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    element.append(link);
    end = match.index + match[0].length;
  }
  element.append(document.createTextNode(text.slice(end)));
}

function renderMessage(message, pending = false, showStatus = true) {
  const row = document.createElement('div');
  row.className = `message-row ${message.role}`;
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  messageContent(bubble, message.content);
  row.append(bubble);
  if (message.role === 'user' && showStatus) {
    const meta = document.createElement('span');
    meta.className = 'message-meta';
    meta.textContent = pending ? 'Sending…' : 'Sent as Text Message';
    row.append(meta);
  }
  $('messages').append(row);
}

function renderReport(report) {
  const card = document.createElement('a');
  card.className = 'report-card';
  card.href = report.url;
  card.download = report.filename;
  card.innerHTML = '<span class="report-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5M8 12h8M8 16h6"/></svg></span><span><strong></strong><small></small></span><svg class="download-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4"/></svg>';
  card.querySelector('strong').textContent = `Callback report #${String(report.number).padStart(4, '0')}`;
  card.querySelector('small').textContent = 'Saved · Download report';
  $('messages').append(card);
}

function addAction(label, action, secondary = false) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `action${secondary ? ' secondary' : ''}`;
  button.textContent = label;
  button.disabled = busy;
  button.addEventListener('click', () => send(label, action));
  $('actions').append(button);
}

function render(next) {
  state = next;
  $('messages').replaceChildren();
  const lastUserIndex = next.messages.map(message => message.role).lastIndexOf('user');
  next.messages.forEach((message, index) => renderMessage(message, false, index === lastUserIndex));
  for (const report of next.reports) renderReport(report);
  $('date-label').textContent = 'Today ' + new Date(next.started_at).toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'});
  $('actions').replaceChildren();
  if (next.callback_pending) {
    addAction('Yes, prepare report', 'confirm_callback');
    addAction('Not now', 'decline_callback', true);
  }
  if (next.report_status === 'failed') addAction('Retry report', 'retry_report');
  $('actions').hidden = !$('actions').children.length;
  if (next.test_mode) $('demo-note').textContent = 'Offline preview · Responses are scripted.';
  scrollToEnd();
}

function scrollToEnd() {requestAnimationFrame(() => {$('thread').scrollTop = $('thread').scrollHeight;});}
function setBusy(value, action = '') {
  busy = value;
  $('message').disabled = value;
  $('send').disabled = value || !$('message').value.trim();
  $('new-chat').disabled = value;
  $('typing').hidden = !value;
  $('typing-label').textContent = action === 'restart' ? 'Restarting…' : /confirm_callback|retry_report/.test(action) ? 'Preparing your report' : 'ReliefRN is replying';
  $('actions').querySelectorAll('button').forEach(b => {b.disabled = value;});
  scrollToEnd();
}
function showError(message, retry) {
  $('error').textContent = message;
  if (retry) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Try again';
    button.addEventListener('click', retry, {once: true});
    $('error').append(button);
  }
  $('error').hidden = false;
}

async function send(text, action = 'message', request = null) {
  if (busy || !text.trim()) return;
  const payload = request || {text: text.trim(), action, request_id: uid()};
  $('error').hidden = true;
  if (state) render(state);
  if (action !== 'retry_report') renderMessage({role: 'user', content: text}, true);
  $('message').value = '';
  $('message').style.height = 'auto';
  setBusy(true, action);
  try {
    const next = await api('/api/message', payload);
    failedRequest = null;
    render(next);
    return {ok: true, report_status: next.report_status};
  } catch (error) {
    failedRequest = payload;
    if (state) render(state);
    $('message').value = text;
    showError(error.message, () => send(payload.text, payload.action, payload));
    return {ok: false, error: error.message};
  } finally {
    setBusy(false);
    if (matchMedia('(min-width: 651px)').matches) $('message').focus();
  }
}

$('message').addEventListener('input', () => {
  $('message').style.height = 'auto';
  $('message').style.height = `${Math.min($('message').scrollHeight, 112)}px`;
  $('send').disabled = busy || !$('message').value.trim();
});
$('composer').addEventListener('submit', (event) => {
  event.preventDefault();
  const text = $('message').value;
  const retry = failedRequest?.text === text.trim() ? failedRequest : null;
  send(text, retry?.action || 'message', retry);
});
$('message').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    if (!$('send').disabled) $('composer').requestSubmit();
  }
});
async function restartDemo() {
  if (busy) return;
  setBusy(true, 'restart');
  try {
    render(await api('/api/session', {new: true}));
    $('message').value = '';
    $('message').style.height = 'auto';
    failedRequest = null;
    $('error').replaceChildren();
    $('error').hidden = true;
  } catch (error) {showError(`Couldn't restart the demo. ${error.message}`, restartDemo);}
  finally {
    setBusy(false);
    if (matchMedia('(min-width: 651px)').matches) $('message').focus();
  }
}
$('new-chat').addEventListener('click', () => {
  if (busy || !confirm('Restart the demo and clear this conversation? Saved reports will remain on this computer.')) return;
  restartDemo();
});

async function initialize() {
  try {render(await api('/api/session')); setBusy(false);}
  catch {showError('Unable to connect to ReliefRN. Check that the local app is running.', initialize);}
}
initialize();

// Optional browser-agent access uses the same visible interaction and server rules.
if (document.modelContext?.registerTool) {
  const lifetime = new AbortController();
  Promise.resolve(document.modelContext.registerTool({
    name: 'send_reliefrn_message',
    title: 'Message ReliefRN',
    description: 'Send a message in the current ReliefRN conversation. A confirmation after an offered callback report can generate and save that report locally.',
    inputSchema: {type: 'object', properties: {message: {type: 'string', minLength: 1, maxLength: 4000}}, required: ['message'], additionalProperties: false},
    annotations: {readOnlyHint: false, untrustedContentHint: true},
    async execute(input) {
      if (!input || typeof input.message !== 'string' || !input.message.trim() || input.message.length > 4000) throw new Error('Enter a message between 1 and 4,000 characters.');
      if (busy || !state) throw new Error('Wait until the conversation is ready.');
      const result = await send(input.message);
      if (!result.ok) throw new Error(result.error);
      return {reply: state.messages.at(-1).content, callback_pending: state.callback_pending, report_status: state.report_status};
    },
  }, {signal: lifetime.signal})).catch(() => {});
  window.addEventListener('pagehide', () => lifetime.abort(), {once: true});
}
