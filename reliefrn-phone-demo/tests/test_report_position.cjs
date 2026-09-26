const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Minimal DOM for checking the actual chat renderer's ordering on each redraw.
class Element {
  constructor() {this.children = []; this.parts = new Map();}
  append(...nodes) {this.children.push(...nodes);}
  replaceChildren(...nodes) {this.children = nodes;}
  addEventListener() {}
  querySelectorAll() {return [];}
  querySelector(selector) {
    if (!this.parts.has(selector)) this.parts.set(selector, new Element());
    return this.parts.get(selector);
  }
}

for (const legacy of [false, true]) {
  test(`report remains between its confirmation and later messages${legacy ? ' with an older server' : ''}`, () => {
    const elements = new Map();
    const get = id => {
      if (!elements.has(id)) elements.set(id, new Element());
      return elements.get(id);
    };
    const sandbox = vm.createContext({
      document: {getElementById: get, createElement: () => new Element(), createTextNode: text => ({textContent: text})},
      setInterval() {}, requestAnimationFrame() {}, fetch: () => new Promise(() => {}),
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../static/app.js'), 'utf8'), sandbox);
    const report = {number: 1, filename: 'report.md', url: '/api/reports/report.md'};
    if (!legacy) report.message_index = 2;
    const state = {started_at: '2026-09-25T00:00:00Z', reports: [report], messages: [
      {role: 'assistant', content: 'Would you like a report?'},
      {role: 'user', content: 'Yes'},
      {role: 'assistant', content: 'Your callback report #0001 has been created and saved. Nothing sent.'},
    ]};
    sandbox.render(state);
    assert.equal(get('messages').children[3].className, 'report-card');
    state.messages.push({role: 'user', content: 'Another question'}, {role: 'assistant', content: 'Another answer'});
    for (let redraw = 0; redraw < 3; redraw++) {
      sandbox.render(state);
      const rows = get('messages').children;
      assert.equal(rows.length, 6);
      assert.equal(rows[3].className, 'report-card');
      assert.equal(rows[3].href, report.url);
      assert.equal(rows[3].download, report.filename);
      assert.equal(rows[4].className, 'message-row user');
      assert.equal(rows[5].className, 'message-row assistant');
      assert.equal(rows.filter(row => row.className === 'report-card').length, 1);
    }
  });
}
