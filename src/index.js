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

    // Fall through to static assets
    return env.ASSETS.fetch(request);
  },
};

async function handleCheckout(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid request body', 400);
  }

  const { priceId } = body;
  if (!priceId || !ALLOWED_PRICE_IDS.has(priceId)) {
    return jsonError('Invalid price ID', 400);
  }

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

  if (!stripeRes.ok) {
    console.error('Stripe error:', session);
    return jsonError(session.error?.message || 'Stripe error', 502);
  }

  return new Response(JSON.stringify({ url: session.url }), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
