// One source of truth for the edition: config/edition.json. Every page, calendar file and the database seed must agree with it.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const edition = JSON.parse(read('config/edition.json'));
const compact = date => date.replaceAll('-', '');
const hour12 = time => { const [h, m] = time.split(':').map(Number); return (h % 12 || 12) + ':' + String(m).padStart(2, '0'); };

test('calendar files match the edition', () => {
  const screening = read('public/screening.ics'), coronation = read('public/coronation.ics');
  assert.ok(screening.includes(`DTSTART;TZID=${edition.timezone}:${compact(edition.screening.date)}T${edition.screening.start.replace(':', '')}00`));
  assert.ok(screening.includes(`DTEND;TZID=${edition.timezone}:${compact(edition.screening.date)}T${edition.screening.end.replace(':', '')}00`));
  assert.ok(coronation.includes('DTSTART;VALUE=DATE:' + compact(edition.coronation.date)));
  if (edition.coronation.start === null) assert.ok(!/DTSTART;TZID/.test(coronation.split('BEGIN:VEVENT')[1]), 'no coronation time may be implied before it is confirmed');
});

test('the database seed matches the edition', () => {
  const sql = read('supabase/migrations/20261114100000_qoq_editions_lifecycle.sql');
  for (const text of [`'${edition.id}'`, `'${edition.name}'`, `'${edition.theme}'`, `'${edition.timezone}'`, `'${edition.organizer}'`,
    `'${edition.screening.date} ${edition.screening.start}:00+08'`, `'${edition.screening.date} ${edition.screening.end}:00+08'`, `'${edition.coronation.date}'`]) assert.ok(sql.includes(text), text);
  const points = read('supabase/migrations/20261114101000_qoq_points_ledger.sql');
  assert.ok(points.includes('price_centavos = points::bigint * ' + edition.pointsRate.pesos * 100 / edition.pointsRate.points));
});

test('public pages state the same dates, times and rate, and invent no venue or coronation time', () => {
  const pages = readdirSync(new URL('../public/', import.meta.url), {recursive: true}).filter(name => name.endsWith('.html') && !/organizer|judge/.test(name)).map(name => [name, read('public/' + name)]);
  const all = pages.map(([, html]) => html).join('\n');
  const window = hour12(edition.screening.start) + '–' + hour12(edition.screening.end) + ' PM';
  assert.ok(all.includes(window), window);
  // Any January date for this edition must be one of the two official dates. Dated citations of other years are history, not schedule.
  for (const [name, html] of pages) for (const match of html.matchAll(/(?:January|JANUARY) (\d{1,2})(?!\d)(, \d{4})?|(\d{2}) (?:January|JANUARY)/g)) {
    if (match[2] && match[2] !== ', 2027') continue;
    const day = Number(match[1] || match[3]);
    assert.ok([Number(edition.screening.date.slice(8)), Number(edition.coronation.date.slice(8))].includes(day), name + ' mentions January ' + day);
  }
  if (edition.coronation.venue === null && edition.screening.venue === null) assert.ok(/[Vv]enue (?:to be|will be) announced|Time and venue/.test(all));
  const rate = `₱${edition.pointsRate.pesos} = ${edition.pointsRate.points.toLocaleString('en-US')}`;
  for (const name of ['vote/index.html', 'voting-rules/index.html']) assert.ok(read('public/' + name).includes(rate), name + ' must state ' + rate);
  // While payment is off, no page may offer a working purchase control outside the server-gated checkout form.
  assert.ok(read('public/vote/index.html').includes('id="checkout" hidden'));
  assert.ok(read('public/vote/index.html').includes('Payment coming soon'));
  assert.ok(!/gcash|maya|paymaya|bank transfer|account number/i.test(all), 'no payment method or account may be advertised before a provider is approved');
});
