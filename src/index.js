const ALLOWED_PRICE_IDS = new Set([
  'price_1Tc7DI4dY2cB0BahhgeUWFeY',
  'price_1Tc7F34dY2cB0BahsUGtj3zt',
  'price_1Tc7GI4dY2cB0BahWV1Zf3L2',
  'price_1Tc7Hw4dY2cB0Bahrl1uK5Uo',
]);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/checkout' && request.method === 'POST') {
      return handleCheckout(request, env);
    }

    if (url.pathname === '/api/webhook' && request.method === 'POST') {
      return handleWebhook(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};

// ── Checkout ──────────────────────────────────────────────────────────────────

async function handleCheckout(request, env) {
  let body;
  try { body = await request.json(); } catch { return jsonError('Invalid request body', 400); }

  const { priceId } = body;
  if (!priceId || !ALLOWED_PRICE_IDS.has(priceId)) return jsonError('Invalid price ID', 400);

  const origin = new URL(request.url).origin;
  const params = new URLSearchParams({
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    mode: 'payment',
    success_url: `${origin}/pricing.html?checkout=success`,
    cancel_url: `${origin}/pricing.html?checkout=cancelled`,
  });

  const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  const session = await stripeRes.json();
  if (!stripeRes.ok) return jsonError(session.error?.message || 'Stripe error', 502);

  return new Response(JSON.stringify({ url: session.url }), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}

// ── Webhook ───────────────────────────────────────────────────────────────────

async function handleWebhook(request, env) {
  const rawBody = await request.text();
  const sig = request.headers.get('stripe-signature');

  const valid = await verifyStripeSignature(rawBody, sig, env.STRIPE_WEBHOOK_SECRET);
  if (!valid) return new Response('Invalid signature', { status: 400 });

  const event = JSON.parse(rawBody);

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = session.customer_details?.email;
    if (email) {
      await sendReportEmail(email, env);
    }
  }

  return new Response('ok');
}

// ── Stripe signature verification ─────────────────────────────────────────────

async function verifyStripeSignature(payload, sigHeader, secret) {
  if (!sigHeader || !secret) return false;

  const parts = Object.fromEntries(sigHeader.split(',').map(p => p.split('=')));
  const timestamp = parts['t'];
  const signature = parts['v1'];
  if (!timestamp || !signature) return false;

  const signed = `${timestamp}.${payload}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signed));
  const expected = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2, '0')).join('');

  return expected === signature;
}

// ── Send report email via Resend ──────────────────────────────────────────────

async function sendReportEmail(toEmail, env) {
  const pdfRes = await env.ASSETS.fetch('https://placeholder/reports/landscaping-report.pdf');
  const pdfBuffer = await pdfRes.arrayBuffer();
  const pdfBase64 = Buffer.from(pdfBuffer).toString('base64');

  const emailBody = {
    from: 'Sherlock Research <onboarding@resend.dev>',
    to: [toEmail],
    subject: 'Your Sherlock Research Report is here',
    html: `
      <div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a">
        <div style="background:#0D1B2A;padding:32px 40px;border-radius:12px 12px 0 0">
          <h1 style="color:#ffffff;font-size:22px;margin:0">Sherlock Research</h1>
        </div>
        <div style="background:#ffffff;padding:40px;border:1px solid #e8e4d6;border-top:none;border-radius:0 0 12px 12px">
          <h2 style="color:#0D1B2A;font-size:20px;margin:0 0 16px">Your report is attached.</h2>
          <p style="color:#6b6b6b;line-height:1.6;margin:0 0 24px">
            Thank you for your purchase. Your Sherlock Research report is attached to this email as a PDF.
            Open it on any device — no special software needed.
          </p>
          <p style="color:#6b6b6b;line-height:1.6;margin:0 0 32px">
            Questions? Reply to this email or reach us at
            <a href="mailto:hello@sherlockresearch.com" style="color:#F26A21">hello@sherlockresearch.com</a>.
          </p>
          <p style="color:#6b6b6b;font-size:13px;margin:0">— The Sherlock Research team</p>
        </div>
      </div>
    `,
    attachments: [
      {
        filename: 'Sherlock_US_Landscaping_Industry_Report_2026.pdf',
        content: pdfBase64,
      },
    ],
  };

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(emailBody),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('Resend error:', err);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────


function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
