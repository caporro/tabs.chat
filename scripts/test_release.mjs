import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const template = await fs.readFile(new URL('deploy/s3-cloudfront.yaml', root), 'utf8');
const source = template.match(/FunctionCode: !Sub \|\n([\s\S]*?)(?=\n  #)/)?.[1];
assert.ok(source, 'Canonical redirect must be defined in the deployment template');
const script = source.split('\n').map(line => line.replace(/^        /, '')).join('\n').replaceAll('${DomainName}', 'tabs.chat');
const context = vm.createContext({});
vm.runInContext(script, context);
function request(host, uri='/', querystring={}) { return {request:{headers:{host:{value:host}},uri,querystring}}; }
const canonical = request('tabs.chat');
assert.equal(context.handler(canonical),canonical.request);
const alternate = request('www.tabs.chat','/agent',{lang:{value:'it'},tag:{value:'a%2Fb',multiValue:[{value:'a%2Fb'},{value:'c'}]}});
const result = context.handler(alternate);
assert.equal(result.statusCode,308);
assert.equal(result.headers.location.value,'https://tabs.chat/agent?lang=it&tag=a%2Fb&tag=c');
assert.equal(context.handler(request('WWW.TABS.CHAT')).headers.location.value,'https://tabs.chat/');
assert.match(template,/MinTTL: 0/);
assert.doesNotMatch(template,/ResponseCode: 200/);
console.log('✓ Canonical www redirect preserves path and repeated/encoded queries; static errors and cache policy remain honest');
