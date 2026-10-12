
'use strict';
const http = require('http');
const https = require('https');

const CHANNELS = new Set(['bob-wacken', 'powermetal', 'progrock', 'bob-ironmaiden', 'bob-metal']);
const respond = (status, body) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' },
  body: JSON.stringify(body)
});

function fetchIcy(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error('too_many_redirects'));
    const transport = url.startsWith('https:') ? https : http;
    let settled = false;
    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      err ? reject(err) : resolve(value);
    };
    const req = transport.get(url, {
      headers: { 'Icy-MetaData': '1', 'User-Agent': 'Mozilla/5.0 WackenRadio/1.0', 'Accept': '*/*' }
    }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        const location = res.headers.location;
        res.destroy();
        if (!location) return finish(new Error('redirect_without_location'));
        const next = new URL(location, url);
        if (!['http:', 'https:'].includes(next.protocol)) return finish(new Error('unsupported_redirect'));
        return fetchIcy(next.href, redirects + 1).then(v => finish(null, v), finish);
      }
      if (res.statusCode !== 200) {
        res.destroy();
        return finish(new Error('upstream_http_' + res.statusCode));
      }
      const interval = Number(res.headers['icy-metaint']);
      if (!Number.isInteger(interval) || interval <= 0 || interval > 1000000) {
        res.destroy();
        return finish(new Error('icy_metadata_not_provided'));
      }
      let remaining = interval, metadataBytes = -1, parts = [], size = 0;
      res.on('data', chunk => {
        let i = 0;
        while (i < chunk.length && !settled) {
          if (remaining > 0) {
            const n = Math.min(remaining, chunk.length - i);
            remaining -= n; i += n;
            continue;
          }
          if (metadataBytes === -1) {
            metadataBytes = chunk[i++] * 16;
            if (metadataBytes === 0) {
              res.destroy();
              return finish(null, null);
            }
          }
          if (metadataBytes > 0) {
            const n = Math.min(metadataBytes, chunk.length - i);
            parts.push(chunk.subarray(i, i + n));
            size += n; metadataBytes -= n; i += n;
            if (metadataBytes === 0) {
              const value = Buffer.concat(parts, size).toString('utf8').replace(/\0+$/g, '');
              res.destroy();
              return finish(null, value);
            }
          }
        }
      });
      res.on('error', finish);
      res.on('end', () => finish(new Error('stream_ended_before_metadata')));
    });
    req.setTimeout(12000, () => req.destroy(new Error('upstream_timeout')));
    req.on('error', finish);
  });
}

exports.handler = async event => {
  const channel = event.queryStringParameters?.channel;
  if (!CHANNELS.has(channel)) return respond(400, { error: 'invalid_channel' });
  try {
    const url = `https://streams.radiobob.de/${channel}/mp3-192/streams.radiobob.de/`;
    const metadata = await fetchIcy(url);
    if (!metadata) return respond(200, { artist: null, title: null, raw: null, source: 'icy' });
    const match = /StreamTitle='([^']*)'/i.exec(metadata);
    const raw = (match?.[1] || '').trim().slice(0, 350);
    if (!raw) return respond(200, { artist: null, title: null, raw: null, source: 'icy' });
    const split = raw.indexOf(' - ');
    return respond(200, {
      artist: split > 0 ? raw.slice(0, split) : null,
      title: split > 0 ? raw.slice(split + 3) : null,
      raw,
      source: 'icy'
    });
  } catch (err) {
    return respond(502, { error: 'metadata_unavailable', reason: err.message });
  }
};
