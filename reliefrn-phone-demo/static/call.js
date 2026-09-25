const $ = id => document.getElementById(id);
let config, current = null, callNumber = 0;
let captionsOn = false;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function state(value, text) {
  $('phone').dataset.state = value;
  $('call-status').textContent = text;
  const running = ['ringing', 'permission', 'connecting', 'active'].includes(value);
  $('action-label').textContent = running ? 'End call' : value === 'ended' ? 'Call again' : 'Call ReliefRN';
  $('call').setAttribute('aria-label', running ? 'End call' : 'Call ReliefRN');
  $('language').disabled = running;
  $('mute').disabled = value !== 'active';
  $('speaker').disabled = value !== 'active';
}
function caption(role, text) {
  const p = document.createElement('p'), label = document.createElement('strong');
  label.textContent = role === 'user' ? 'You' : 'ReliefRN';
  p.append(label, document.createTextNode(text));
  p.dir = 'auto';
  $('captions').append(p);
  while ($('captions').children.length > 30) $('captions').firstChild.remove();
  $('captions').scrollTop = $('captions').scrollHeight;
}
function stopAudio(call) {
  for (const source of call.sources) {try {source.stop();} catch {}}
  call.sources.clear();
  call.nextAudio = 0;
}
function finish(message = '') {
  const call = current;
  current = null;
  if (call) {
    clearInterval(call.timer);
    clearTimeout(call.timeout);
    if (call.socket?.readyState === WebSocket.OPEN) call.socket.send(JSON.stringify({type: 'end'}));
    call.socket?.close();
    call.stream?.getTracks().forEach(track => track.stop());
    call.capture?.disconnect();
    call.input?.disconnect();
    stopAudio(call);
    call.context?.close().catch(() => {});
    if (config?.preview) window.speechSynthesis?.cancel();
  }
  state('ended', message ? 'Call unavailable' : 'Call ended');
  $('hint').textContent = message ? 'You can try again or switch to Messages.' : 'Take care. We’re here when you need us.';
  $('error').textContent = message;
  $('error').hidden = !message;
  $('privacy').textContent = 'Microphone off · No report or callback was created.';
  $('mute').setAttribute('aria-pressed', 'false');
}
function fail(call, message) {if (current === call) finish(message);}
function ring(call) {
  const gain = call.context.createGain();
  gain.gain.value = .045;
  gain.connect(call.context.destination);
  for (const frequency of [440, 480]) {
    const oscillator = call.context.createOscillator();
    oscillator.frequency.value = frequency;
    oscillator.connect(gain);
    oscillator.start();
    oscillator.stop(call.context.currentTime + 1.1);
    call.sources.add(oscillator);
    oscillator.onended = () => call.sources.delete(oscillator);
  }
}
function play(call, encoded) {
  const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
  // An empty delta made createBuffer throw NotSupportedError, and the catch-all
  // around onmessage turned that one bad frame into a dropped call.
  if (bytes.length < 2) return;
  // Azure streams faster than real time, so this runs hot on the main thread --
  // the same thread that must service the capture port every 40 ms. An Int16Array
  // view over the bytes is markedly cheaper than a per-sample DataView read.
  const pcm = new Int16Array(bytes.buffer, 0, bytes.length >> 1);
  const buffer = call.context.createBuffer(1, pcm.length, 24000);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < pcm.length; i++) samples[i] = pcm[i] / 32768;
  const source = call.context.createBufferSource();
  source.buffer = buffer;
  source.connect(call.output);
  const when = Math.max(call.context.currentTime + .025, call.nextAudio || 0);
  // Azure can generate audio faster than real-time playback. A long queue is
  // normal for detailed replies; keep playing until finished or interrupted.
  source.start(when);
  call.nextAudio = when + buffer.duration;
  call.sources.add(source);
  source.onended = () => {call.sources.delete(source); source.disconnect();};
  $('call-status').textContent = 'ReliefRN is speaking';
}
function connected(call, preview = false) {
  if (call.ready) return;
  clearTimeout(call.timeout);
  call.ready = true;
  call.started = Date.now();
  state('active', preview ? 'Preview connected' : 'Connected · Listening');
  $('hint').textContent = preview ? 'Scripted greeting only. Live speech recognition is off.' : 'Speak naturally. You can interrupt at any time.';
  $('privacy').textContent = preview ? 'Local microphone test · Audio is not sent to Azure.' : 'Microphone on · Voice processed by Microsoft Azure.';
  call.timer = setInterval(() => {
    const seconds = Math.floor((Date.now() - call.started) / 1000);
    $('timer').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
    // Waiting on a turn that never arrives used to show "Connected · Listening"
    // indefinitely, which reassured the caller while nothing was happening. Say so
    // instead of ending the call: a short utterance may legitimately draw no reply.
    if (call.awaiting && Date.now() - call.awaiting > 12000) {
      $('call-status').textContent = 'Still waiting for ReliefRN…';
      return;
    }
    if (call.sources.size === 0 && !call.muted) $('call-status').textContent = preview ? 'Preview connected' : 'Connected · Listening';
  }, 1000);
}
async function start() {
  const call = {id: ++callNumber, sources: new Set(), muted: false, ready: false, speaker: true};
  current = call;
  $('captions').replaceChildren();
  $('timer').textContent = '00:00';
  $('error').hidden = true;
  $('speaker').setAttribute('aria-pressed', 'true');
  state('ringing', 'Calling…');
  $('hint').textContent = 'Connecting you with ReliefRN';
  try {
    call.context = new AudioContext({sampleRate: 24000});
    await call.context.resume();
    // Checked here rather than after getUserMedia: the caller should not grant the
    // microphone and only then be told the browser cannot run the call at all.
    if (call.context.sampleRate !== 24000) throw new Error('This browser cannot open 24 kHz audio. Try Chrome or Edge.');
    if (current !== call) return;
    ring(call);
    await sleep(1200);
    if (current !== call) return;
    state('permission', 'Allow microphone to continue');
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microphone access requires localhost or HTTPS and a supported browser.');
    const stream = await navigator.mediaDevices.getUserMedia({audio: {channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true}, video: false});
    if (current !== call) {stream.getTracks().forEach(track => track.stop()); return;}
    call.stream = stream;
    call.output = call.context.createGain();
    call.output.connect(call.context.destination);
    await call.context.audioWorklet.addModule('/static/voice-capture.js');
    if (current !== call) return;
    call.input = call.context.createMediaStreamSource(stream);
    call.capture = new AudioWorkletNode(call.context, 'voice-capture');
    const silent = call.context.createGain();
    silent.gain.value = 0;
    call.input.connect(call.capture);
    call.capture.connect(silent).connect(call.context.destination);
    call.silence = new Uint8Array(1920);
    call.capture.port.onmessage = event => {
      if (current !== call || !call.ready || config.preview || call.socket?.readyState !== WebSocket.OPEN) return;
      // Muting used to stop sending altogether, so the server-side buffer never
      // advanced, the silence timer never elapsed and the turn never closed -- the
      // agent simply never replied. Keep the stream running with real silence.
      const frame = call.muted ? call.silence : new Uint8Array(event.data);
      // 128000 bytes is under 2 s of audio at 25 frames/s, so a brief stall used to
      // end the call outright. A backlog means a slow tab, not a dead connection:
      // shed frames and recover, and only give up once it stays congested.
      if (call.socket.bufferedAmount > 262144) {
        call.congested = (call.congested || 0) + 1;
        if (call.congested > 250) fail(call, 'The connection cannot keep up with audio. Please call again.');
        return;
      }
      call.congested = 0;
      let binary = '';
      for (let i = 0; i < frame.length; i += 4096) binary += String.fromCharCode.apply(null, frame.subarray(i, i + 4096));
      call.socket.send(JSON.stringify({type: 'audio', audio: btoa(binary)}));
    };
    state('connecting', config.preview ? 'Opening preview…' : 'Connecting voice…');
    call.socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/voice/stream?language=${encodeURIComponent($('language').value)}`);
    call.timeout = setTimeout(() => fail(call, 'The voice connection timed out. Please try again.'), 45000);
    call.socket.onmessage = event => {
      if (current !== call) return;
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'ready') connected(call);
        else if (message.type === 'audio') {call.awaiting = 0; play(call, message.audio);}
        else if (message.type === 'transcript') caption(message.role, message.text);
        // The server has always sent response_done; nothing here ever read it.
        else if (message.type === 'response_done') call.awaiting = 0;
        else if (message.type === 'interrupt') {
          stopAudio(call);
          call.awaiting = Date.now();
          $('call-status').textContent = call.muted ? 'Microphone muted' : 'Listening to you';
        }
        else if (message.type === 'error') fail(call, message.message);
        else if (message.type === 'preview') {
          connected(call, true);
          caption('assistant', message.text);
          if ('speechSynthesis' in window) {
            const utterance = new SpeechSynthesisUtterance(message.text);
            utterance.lang = 'en-US'; utterance.rate = .95;
            window.speechSynthesis.speak(utterance);
          }
        }
      } catch (error) {fail(call, error.message);}
    };
    call.socket.onerror = () => fail(call, 'Unable to connect to voice. Check the local app and try again.');
    call.socket.onclose = () => {if (current === call) finish('The voice connection ended. You can call again.');};
    for (const track of stream.getAudioTracks()) track.onended = () => fail(call, 'Microphone access ended. Please call again.');
  } catch (error) {
    const messages = {NotAllowedError: 'Microphone access was denied. Allow it in your browser’s site settings, then call again.', NotFoundError: 'No microphone was found. Connect one, then call again.', NotReadableError: 'Your microphone is unavailable. Close other apps using it and try again.'};
    fail(call, messages[error.name] || error.message);
  }
}
$('call').onclick = () => current ? finish() : start();
$('mute').onclick = () => {
  if (!current?.ready) return;
  current.muted = !current.muted;
  current.stream.getAudioTracks().forEach(track => {track.enabled = !current.muted;});
  $('mute').setAttribute('aria-pressed', String(current.muted));
  $('call-status').textContent = current.muted ? 'Microphone muted' : 'Connected · Listening';
};
$('speaker').onclick = () => {
  if (!current?.ready) return;
  current.speaker = !current.speaker;
  current.output.gain.value = current.speaker ? 1 : 0;
  if (config.preview && !current.speaker) window.speechSynthesis?.cancel();
  $('speaker').setAttribute('aria-pressed', String(current.speaker));
};
$('captions-toggle').onclick = () => {
  captionsOn = !captionsOn;
  $('captions').hidden = !captionsOn;
  $('hint').hidden = captionsOn;
  $('captions-toggle').setAttribute('aria-pressed', String(captionsOn));
};
window.addEventListener('pagehide', () => {if (current) finish();});
function clock() {$('clock').textContent = new Date().toLocaleTimeString([], {hour: 'numeric', minute: '2-digit', hour12: false});}
clock(); setInterval(clock, 30000);
(async () => {
  try {
    const response = await fetch('/api/voice/config');
    if (!response.ok) throw new Error('Voice configuration unavailable. Reload to try again.');
    config = await response.json();
    for (const language of config.languages) {
      const option = document.createElement('option');
      option.value = language.code;
      option.textContent = `${language.native} · ${language.name}`;
      $('language').append(option);
    }
    if (config.preview) $('demo-note').textContent = 'Offline preview · Scripted greeting · No live recognition';
    $('call').disabled = false;
  } catch (error) {$('error').hidden = false; $('error').textContent = error.message;}
})();
