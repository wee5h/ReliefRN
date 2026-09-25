const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function fixture() {
  const elements = new Map();
  const sandbox = vm.createContext({
    document: {getElementById(id) {
      if (!elements.has(id)) elements.set(id, {});
      return elements.get(id);
    }},
    window: {addEventListener() {}}, setInterval() {},
    fetch: () => new Promise(() => {}),
    atob: value => Buffer.from(value, 'base64').toString('binary'),
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../static/call.js'), 'utf8'), sandbox);
  const nodes = [];
  const call = {sources: new Set(), output: {}, context: {
    currentTime: 10,
    createBuffer(channels, length, rate) {
      return {duration: length / rate, getChannelData: () => new Float32Array(length)};
    },
    createBufferSource() {
      const node = {connect() {}, start(time) {this.when = time;},
        stop() {this.stopped = true;}, disconnect() {this.disconnected = true;}};
      nodes.push(node);
      return node;
    },
  }};
  return {sandbox, call, nodes};
}

test('a minute of rapidly generated audio queues continuously without ending the call', () => {
  const {sandbox, call, nodes} = fixture();
  const second = Buffer.alloc(48000).toString('base64');
  for (let i = 0; i < 60; i++) sandbox.play(call, second);
  assert.equal(nodes.length, 60);
  assert.equal(call.sources.size, 60);
  nodes.forEach((node, i) => assert.ok(Math.abs(node.when - (10.025 + i)) < 1e-9));
  assert.ok(Math.abs(call.nextAudio - 70.025) < 1e-9);
  nodes[0].onended();
  assert.equal(call.sources.size, 59);
  assert.equal(nodes[0].disconnected, true);
  sandbox.stopAudio(call);
  assert.ok(nodes.slice(1).every(node => node.stopped));
  assert.equal(call.sources.size, 0);
  assert.equal(call.nextAudio, 0);
  sandbox.play(call, second);
  assert.equal(nodes[60].when, 10.025);
});
