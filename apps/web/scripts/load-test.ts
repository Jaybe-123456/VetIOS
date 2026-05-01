// @ts-nocheck
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '30s', target: 50 },
    { duration: '1m', target: 500 },
    { duration: '2m', target: 1000 },
    { duration: '1m', target: 5000 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    http_req_failed: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.VETIOS_URL || 'https://vetios.tech';
const AUTH_HEADERS = {
  Authorization: `Bearer ${__ENV.TEST_TOKEN}`,
};

function hasMode(body: string | null): boolean {
  if (!body) return false;
  try {
    const parsed = JSON.parse(body);
    return parsed.mode !== undefined || parsed.data?.mode !== undefined;
  } catch {
    return false;
  }
}

export default function () {
  const landing = http.get(`${BASE_URL}/`);
  check(landing, { 'landing 200': (r) => r.status === 200 });

  const signals = http.get(`${BASE_URL}/api/population-signal`, {
    headers: AUTH_HEADERS,
  });
  check(signals, {
    'signals 200': (r) => r.status === 200,
    'signals fast': (r) => r.timings.duration < 300,
  });

  const ask = http.post(
    `${BASE_URL}/api/ask-vetios`,
    JSON.stringify({
      message: 'dog vomiting lethargy 3 days',
      conversation: [],
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        ...AUTH_HEADERS,
      },
    }
  );
  check(ask, {
    'ask 200': (r) => r.status === 200,
    'ask has mode': (r) => hasMode(r.body),
  });

  const inference = http.post(
    `${BASE_URL}/api/inference`,
    JSON.stringify({
      input: {
        input_signature: {
          species: 'canine',
          symptoms: ['vomiting', 'lethargy'],
        },
      },
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        ...AUTH_HEADERS,
      },
    }
  );
  check(inference, { 'inference 200': (r) => r.status === 200 });

  sleep(1);
}
